import type { Candidate } from '../../shared/contracts.js';

const candidate = (id: string, name: string, company: string, role: string, summary: string, sourceRound: 'company' | 'role'): Candidate => ({
  id,
  jobId: 'demo-industrial-sales-director',
  dedupeKey: `demo-key-${id}`,
  name,
  guluId: `DEMO-${id}`,
  detailUrl: `http://127.0.0.1/demo/candidates/${id}`,
  currentCompany: company,
  currentRole: role,
  sourceRound,
  experiences: [{ company, role, period: '2021年至今', summary }],
});

export const demoCompanyRound: Candidate[] = [
  candidate('demo-1', '候选人甲', '启明制造', '大客户销售总监', '负责大型制造企业客户拓展，连续三年完成年度目标。', 'company'),
  candidate('demo-2', '候选人乙', '远航工业', '区域销售经理', '主导大型制造企业客户拓展与经销体系建设。', 'company'),
  candidate('demo-3', '候选人丙', '精工科技', '商务经理', '负责企业级解决方案销售和关键客户续约。', 'company'),
  candidate('demo-4', '候选人丁', '华岳设备', '销售经理', '开拓装备制造客户并带领五人团队。', 'company'),
  candidate('demo-5', '候选人戊', '新锐自动化', '客户经理', '负责工业客户需求分析与项目交付协同。', 'company'),
];

export const demoRoleRound: Candidate[] = [
  { ...candidate('demo-1', '候选人甲', '启明制造', '大客户销售总监', '负责大型制造企业客户拓展，连续三年完成年度目标。', 'role'), dedupeKey: 'demo-key-demo-1' },
  candidate('demo-6', '候选人己', '未披露公司', '销售经理', '经历描述较少，客户类型和业绩信息缺失。', 'role'),
  candidate('demo-7', '候选人庚', '云端软件', '客户成功经理', '负责软件客户续费和使用培训，销售经历相邻。', 'role'),
  candidate('demo-8', '候选人辛', '连锁商贸', '门店主管', '仅零售门店销售，无企业客户项目经历。', 'role'),
  candidate('demo-9', '候选人壬', '宏达机械', '行业销售经理', '完成大型制造企业客户拓展并参与投标。', 'role'),
  candidate('demo-10', '候选人癸', '智造咨询', '顾问', '为制造企业提供增长咨询，具备可迁移行业经验。', 'role'),
];
