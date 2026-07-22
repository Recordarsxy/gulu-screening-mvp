const SERVICE = 'http://127.0.0.1:4318';
const GULU = 'http://121.43.105.7/crm#candidate/list';
let active = false;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pace = () => delay(800 + Math.floor(Math.random() * 701));

async function reloadIfUpdated() {
  try {
    const response = await fetch(chrome.runtime.getURL('revision.txt'), { cache: 'no-store' });
    const revision = (await response.text()).trim();
    if (!revision) return false;
    const { extensionRevision } = await chrome.storage.local.get(['extensionRevision']);
    if (!extensionRevision) {
      await chrome.storage.local.set({ extensionRevision: revision });
      return false;
    }
    if (extensionRevision !== revision) {
      await chrome.storage.local.set({ extensionRevision: revision });
      chrome.runtime.reload();
      return true;
    }
  } catch {}
  return false;
}

async function stored() {
  return chrome.storage.local.get(['connectorToken', 'guluTabId', 'lastTaskId']);
}

async function api(path, init = {}) {
  const { connectorToken } = await stored();
  const response = await fetch(`${SERVICE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: connectorToken ? `Bearer ${connectorToken}` : '',
      ...init.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `local_service_${response.status}`);
  return data;
}

async function send(tabId, operation, args = {}) {
  const response = await Promise.race([
    chrome.tabs.sendMessage(tabId, { operation, args }),
    delay(5000).then(() => { throw new Error('adapter_timeout'); }),
  ]);
  if (!response?.ok) throw new Error(response?.error ?? 'adapter_unavailable');
  return response.result;
}

async function waitReady(tabId) {
  for (let i = 0; i < 30; i += 1) {
    await delay(500);
    try {
      const state = await send(tabId, 'inspectState');
      if (state.state === 'loading') continue;
      return state;
    } catch {}
  }
  throw new Error('gulu_tab_unavailable');
}

async function ensureTab() {
  const saved = await stored();
  if (saved.guluTabId) {
    try {
      const tab = await chrome.tabs.get(saved.guluTabId);
      if (tab?.url?.startsWith('http://121.43.105.7/')) return tab;
    } catch {}
  }
  const found = await chrome.tabs.query({ url: 'http://121.43.105.7/*' });
  const tab = found[0] ?? await chrome.tabs.create({ url: GULU, active: false });
  await chrome.storage.local.set({ guluTabId: tab.id });
  return tab;
}

async function event(taskId, type, payload = {}, eventId = crypto.randomUUID()) {
  return api(`/api/connector/gulu/tasks/${taskId}/events`, {
    method: 'POST',
    body: JSON.stringify({ eventId, type, ...payload }),
  });
}

function candidateEventId(task, seed) {
  return `candidate:${task.id}:${task.currentRound}:${seed.guluId}`;
}

function campaignCandidateEventId(task, step, seed) {
  return `candidate:${task.id}:${step.id}:${seed.guluId}`;
}

function resumeSoon() {
  chrome.alarms.create('gulu-resume', { when: Date.now() + 1000 });
}

async function waitListSettled(tabId, expectedPage, { minimumDelay = 0, previousSignature = null } = {}) {
  const started = Date.now();
  let stableSignature = null;
  let stableCount = 0;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    await delay(400);
    const state = await send(tabId, 'inspectListState');
    const changed = state.empty || previousSignature === null || state.signature !== previousSignature;
    if (!state.loading && state.queryReady && state.resultReady && state.page === expectedPage && changed && Date.now() - started >= minimumDelay) {
      stableCount = state.signature === stableSignature ? stableCount + 1 : 1;
      stableSignature = state.signature;
      if (stableCount >= 3) return state;
    } else {
      stableCount = 0;
    }
  }
  throw new Error('list_not_settled');
}

async function restoreList(tabId, round, page, submit) {
  chrome.tabs.update(tabId, { url: GULU }).catch(() => {});
  await delay(500);
  chrome.tabs.reload(tabId).catch(() => {});
  await delay(500);
  const state = await waitReady(tabId);
  if (state.state === 'login_required' || state.state === 'captcha') return state;
  if (state.state !== 'list') throw new Error('unsupported_page');

  const scopeChange = await send(tabId, 'ensureAllTalentScope');
  if (scopeChange.changed) {
    await delay(1000);
    const scopeState = await waitReady(tabId);
    if (scopeState.state !== 'list') throw new Error(scopeState.state);
  }
  const scope = scopeChange.changed ? { scope: 'all_talent' } : await send(tabId, 'inspectCandidateScope');
  if (scope.scope !== 'all_talent') throw new Error('candidate_scope_not_all_talent');

  await send(tabId, 'resetFilters');
  const beforeQuery = await send(tabId, 'inspectListState');
  await send(tabId, 'applyFilters', { filters: round.filters, submit, reset: false });
  if (!submit) return { state: 'list' };
  await waitListSettled(tabId, 1, { minimumDelay: 2500, previousSignature: beforeQuery.signature });

  for (let current = 1; current < page; current += 1) {
    const before = await send(tabId, 'inspectListState');
    const hasNext = await send(tabId, 'nextPage');
    if (!hasNext) throw new Error('page_restore_failed');
    await waitListSettled(tabId, current + 1, { minimumDelay: 400, previousSignature: before.signature });
  }
  state = await send(tabId, 'inspectState');
  if (state.state !== 'list') throw new Error(state.state);
  return state;
}

async function runCampaignTask({ task, campaign, steps, step }) {
  const tab = await ensureTab();
  if (task.phase === 'preflight') {
    for (const item of steps) {
      const state = await restoreList(tab.id, item, 1, false);
      if (state.state === 'login_required' || state.state === 'captcha') {
        await event(task.id, 'needs_attention', { error: state.state }, `attention:${task.id}:${state.state}`);
        return;
      }
    }
    await event(task.id, 'preflight_completed', {}, `preflight:${task.id}`);
    resumeSoon();
    return;
  }
  if (!step) throw new Error('search_step_missing');
  const progress = task.stepProgress.find((item) => item.stepId === step.id);
  if (!progress) throw new Error('search_step_progress_missing');
  const state = await restoreList(tab.id, step, progress.page, true);
  if (state.state === 'login_required' || state.state === 'captcha') {
    await event(task.id, 'needs_attention', { error: state.state }, `attention:${task.id}:${state.state}`);
    return;
  }
  if (progress.status === 'pending') await event(task.id, 'step_started', { stepId: step.id }, `step-start:${task.id}:${step.id}`);
  const list = await send(tab.id, 'readList', { page: progress.page });
  if (list.length === 0) {
    await event(task.id, 'step_completed', { stepId: step.id, empty: true }, `step-complete:${task.id}:${step.id}`);
    resumeSoon();return;
  }
  const checked = await api(`/api/connector/gulu/tasks/${task.id}/candidates/check`, { method: 'POST', body: JSON.stringify({ guluIds: list.map((seed) => seed.guluId) }) });
  const unseen = new Set(checked.unseen);
  let cursor = progress.candidateCursor;
  let added = 0;
  const target = task.phase === 'calibration' ? Math.min(5, step.limit) : step.limit;
  while (cursor < list.length && progress.readCount + added < target) {
    const seed = list[cursor];
    if (unseen.has(seed.guluId)) {
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const detail = await chrome.tabs.create({ url: seed.detailUrl, active: false });
        try {
          const detailState = await waitReady(detail.id);if (detailState.state !== 'detail') throw new Error(detailState.state);
          const snapshot = await send(detail.id, 'readDetail', { seed, sourceRound: 'campaign', sourceStepId: step.id, page: progress.page });
          await event(task.id, 'candidate', { snapshot: { ...snapshot, sourceRound: 'campaign', sourceStepId: step.id } }, campaignCandidateEventId(task, step, seed));
          lastError = null;added += 1;break;
        } catch (error) { lastError = error;if (attempt === 0) await pace(); }
        finally { await chrome.tabs.remove(detail.id).catch(() => {}); }
      }
      if (lastError) {
        const failure = await event(task.id, 'failure', { error: String(lastError?.message ?? lastError) }, `candidate-failure:${task.id}:${step.id}:${seed.guluId}`);
        if (failure.status === 'needs_attention') return;
      }
    }
    cursor += 1;
    await event(task.id, 'checkpoint', { checkpoint: { candidateCursor: cursor } }, `cursor:${task.id}:${step.id}:${progress.page}:${cursor}`);
    await pace();
  }
  const read = progress.readCount + added;
  if (task.phase === 'calibration' && read >= 5) {
    await event(task.id, 'step_calibrated', { stepId: step.id, exhausted: false }, `step-calibrated:${task.id}:${step.id}`);resumeSoon();return;
  }
  if (read >= step.limit || task.readCount + added >= campaign.maxUniqueCandidates) {
    await event(task.id, 'step_completed', { stepId: step.id, empty: false }, `step-complete:${task.id}:${step.id}`);resumeSoon();return;
  }
  const hasNext = await send(tab.id, 'nextPage');
  if (hasNext) await event(task.id, 'checkpoint', { checkpoint: { page: progress.page + 1, candidateCursor: 0 } }, `page:${task.id}:${step.id}:${progress.page + 1}`);
  else if (task.phase === 'calibration') await event(task.id, 'step_calibrated', { stepId: step.id, exhausted: true }, `step-calibrated:${task.id}:${step.id}`);
  else await event(task.id, 'step_completed', { stepId: step.id, empty: false }, `step-complete:${task.id}:${step.id}`);
  resumeSoon();
}

async function runOnce() {
  if (active) {
    await api('/api/connector/gulu/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ status: 'online', busy: true, extensionVersion: chrome.runtime.getManifest().version }),
    }).catch(() => {});
    return;
  }
  if (await reloadIfUpdated()) return;
  active = true;
  let currentTask = null;
  try {
    const next = await api('/api/connector/gulu/tasks/next');
    await api('/api/connector/gulu/heartbeat', { method: 'POST', body: JSON.stringify({ status: 'online', extensionVersion: chrome.runtime.getManifest().version }) });
    if (!next.task) return;

    const { task, plan } = next;
    currentTask = task;
    const saved = await stored();
    const isNewTask = saved.lastTaskId !== task.id;
    if (task.status === 'queued') {
      await event(task.id, 'checkpoint', { checkpoint: { status: 'running' } }, `start:${task.id}`);
    }
    if (task.campaignId) {
      await runCampaignTask(next);
      if (isNewTask) await chrome.storage.local.set({ lastTaskId: task.id });
      return;
    }

    const round = plan.rounds.find((item) => item.kind === task.currentRound);
    if (!round) throw new Error('search_round_missing');
    const tab = await ensureTab();
    const state = await restoreList(tab.id, round, task.page, task.mode !== 'dry-run');
    if (state.state === 'login_required' || state.state === 'captcha') {
      await event(task.id, 'needs_attention', { error: state.state }, `attention:${task.id}:${state.state}`);
      return;
    }
    if (isNewTask) await chrome.storage.local.set({ lastTaskId: task.id });
    await event(task.id, 'round_started', { round: task.currentRound }, `round-start:${task.id}:${task.currentRound}`);

    if (task.mode === 'dry-run') {
      await event(task.id, 'round_completed', { round: task.currentRound, empty: false }, `round-complete:${task.id}:${task.currentRound}`);
      if (task.currentRound === 'company') {
        await event(task.id, 'checkpoint', {
          checkpoint: { currentRound: 'role', page: 1, candidateCursor: 0 },
        }, `dry-round:${task.id}:role`);
        resumeSoon();
      } else {
        await event(task.id, 'completed', {}, `complete:${task.id}`);
      }
      return;
    }

    const list = await send(tab.id, 'readList', { page: task.page });
    let cursor = task.candidateCursor;
    let roundRead = task.roundReadCount;
    let totalRead = task.readCount;

    while (cursor < list.length && (task.mode === 'pilot' ? totalRead < 5 : roundRead < round.limit)) {
      const seed = list[cursor];
      const stableEventId = candidateEventId(task, seed);
      let lastError = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const detail = await chrome.tabs.create({ url: seed.detailUrl, active: false });
        try {
          const detailState = await waitReady(detail.id);
          if (detailState.state !== 'detail') throw new Error(detailState.state);
          const snapshot = await send(detail.id, 'readDetail', {
            seed,
            sourceRound: task.currentRound,
            page: task.page,
          });
          await event(task.id, 'candidate', { snapshot }, stableEventId);
          lastError = null;
          roundRead += 1;
          totalRead += 1;
          break;
        } catch (error) {
          lastError = error;
          if (attempt === 0) await pace();
        } finally {
          await chrome.tabs.remove(detail.id).catch(() => {});
        }
      }

      if (lastError) {
        const failure = await event(task.id, 'failure', {
          error: String(lastError?.message ?? lastError),
        }, `candidate-failure:${task.id}:${task.currentRound}:${seed.guluId}`);
        if (failure.status === 'needs_attention') return;
      }

      cursor += 1;
      await event(task.id, 'checkpoint', {
        checkpoint: { candidateCursor: cursor },
      }, `cursor:${task.id}:${task.currentRound}:${task.page}:${cursor}`);
      await pace();
    }

    if (task.mode === 'pilot' && totalRead >= 5) {
      await event(task.id, 'round_completed', { round: task.currentRound, empty: false }, `round-complete:${task.id}:${task.currentRound}`);
      await event(task.id, 'completed', {}, `complete:${task.id}`);
      return;
    }

    if ((task.mode !== 'pilot' && roundRead >= round.limit) || list.length === 0) {
      await event(task.id, 'round_completed', { round: task.currentRound, empty: list.length === 0 }, `round-complete:${task.id}:${task.currentRound}`);
      if (task.currentRound === 'company') {
        await event(task.id, 'checkpoint', {
          checkpoint: { currentRound: 'role', page: 1, candidateCursor: 0 },
        }, `round:${task.id}:role`);
        resumeSoon();
      } else if (task.mode === 'pilot') {
        await event(task.id, 'needs_attention', { error: 'pilot_insufficient_candidates' }, `attention:${task.id}:pilot-insufficient`);
      } else {
        await event(task.id, 'completed', {}, `complete:${task.id}`);
      }
      return;
    }

    const hasNext = await send(tab.id, 'nextPage');
    if (hasNext) {
      await event(task.id, 'checkpoint', {
        checkpoint: { page: task.page + 1, candidateCursor: 0 },
      }, `page:${task.id}:${task.currentRound}:${task.page + 1}`);
    } else if (task.currentRound === 'company') {
      await event(task.id, 'round_completed', { round: task.currentRound, empty: false }, `round-complete:${task.id}:${task.currentRound}`);
      await event(task.id, 'checkpoint', {
        checkpoint: { currentRound: 'role', page: 1, candidateCursor: 0 },
      }, `round:${task.id}:role`);
      resumeSoon();
    } else if (task.mode === 'pilot') {
      await event(task.id, 'round_completed', { round: task.currentRound, empty: false }, `round-complete:${task.id}:${task.currentRound}`);
      await event(task.id, 'needs_attention', { error: 'pilot_insufficient_candidates' }, `attention:${task.id}:pilot-insufficient`);
    } else {
      await event(task.id, 'round_completed', { round: task.currentRound, empty: false }, `round-complete:${task.id}:${task.currentRound}`);
      await event(task.id, 'completed', {}, `complete:${task.id}`);
    }
  } catch (error) {
    const message = String(error?.message ?? error);
    if (currentTask && !['task_not_running', 'task_aborted'].includes(message)) {
      const immediateAttention = [
        'filter_control_changed',
        'search_control_changed',
        'unsupported_page',
        'gulu_tab_unavailable',
        'page_restore_failed',
        'list_not_settled',
        'permission_denied',
        'candidate_scope_unavailable',
        'candidate_scope_not_all_talent',
      ].some((code) => message === code || message.startsWith(`${code}:`));
      await event(
        currentTask.id,
        immediateAttention ? 'needs_attention' : 'failure',
        { error: message },
        `connector-error:${currentTask.id}:${currentTask.currentRound}:${currentTask.page}:${message}`,
      ).catch(() => {});
    }
    await api('/api/connector/gulu/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ status: 'error', error: message, extensionVersion: chrome.runtime.getManifest().version }),
    }).catch(() => {});
  } finally {
    active = false;
  }
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('gulu-poll', { periodInMinutes: 0.5 }));
chrome.alarms.onAlarm.addListener(() => runOnce());
chrome.runtime.onStartup.addListener(() => runOnce());
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'pair') {
      const result = await fetch(`${SERVICE}/api/connector/gulu/pairing/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: String(message.code), extensionVersion: chrome.runtime.getManifest().version }),
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        return data;
      });
      await chrome.storage.local.set({ connectorToken: result.token });
      runOnce();
      return { ok: true };
    }
    if (message?.type === 'status') {
      const values = await stored();
      return { ok: true, paired: Boolean(values.connectorToken) };
    }
    if (message?.type === 'poll') {
      runOnce();
      return { ok: true };
    }
    return { ok: false, error: 'unsupported_message' };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
  return true;
});
