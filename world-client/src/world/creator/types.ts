/** 造物者角色的上下文与参数类型定义 */

import type { AutonomyLevel } from './fuse.ts';

/** 造物主角色的身份标识 */
export type CreatorRoleId =
  | 'interpreter'    // 解释器：自然语言 → 世界命令
  | 'art_supervisor' // 艺术监督：视觉一致性与调色板管理
  | 'mapper'         // 地图师：建筑布局与空间分配
  | 'historian'      // 历史学家：记忆书写与编年史
  | 'director'       // 导演：节奏注入与世界事件
  | 'auditor'        // 审计员：不变式检查与质量门禁

/** 建造者的职责范围 */
export interface BuilderContext {
  /** 当前角色 ID */
  readonly roleId: CreatorRoleId;
  /** 当前自治等级 */
  readonly autonomyLevel: AutonomyLevel;
  /** 目标自治等级（爬到就停） */
  readonly targetLevel: AutonomyLevel;
  /** 是否正在熔断隔离期 */
  readonly isFused: boolean;
}

/** 建造结果反馈 */
export interface BuildFeedback {
  /** 是否通过 Schema 校验 */
  schemaPassed: boolean;
  /** 是否存在冲突 */
  hasConflict: boolean;
  /** 要素覆盖率（0-1，undefined 表示未观察） */
  coverageRate?: number;
  /** 寻路是否连通 */
  pathfindingConnected?: boolean;
  /** 是否有碰撞 */
  hasCollision?: boolean;
  /** 空间约束是否满足 */
  spatialConstraintSatisfied?: boolean;
  /** 是否有人工修改 */
  wasManuallyModified?: boolean;
  /** 是否违反不变式 */
  invariantViolated?: boolean;
  /** 是否可以溯源 */
  traceable?: boolean;
  /** 回放哈希是否一致 */
  replayHashConsistent?: boolean;
}

/** 人类确认的响应 */
export interface HumanApprovalResponse {
  /** 是否批准 */
  approved: boolean;
  /** 修改建议（如有） */
  modifications?: Record<string, unknown>;
  /** 拒绝理由 */
  rejectionReason?: string;
}
