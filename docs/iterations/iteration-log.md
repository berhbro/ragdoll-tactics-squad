# 迭代记录 (Iteration Log)

## Day 1 - Day 2：工程搭建与输入系统
- **问题**：Firefox 浏览器强制拦截 `Shift + 右键` 并弹出系统菜单，且 `preventDefault()` 无法阻止。
- **原因**：Firefox 的 `dom.event.contextmenu.shift_suppresses_event` 默认开启，事件未下发给 JS。
- **解决**：
  1. 物理键位增加 `Alt + 右键` 作为追加路径的替代方案（Chrome/Edge 下两者均可用）。
  2. 接口重构：将输入事件中的 `shift: boolean` 重命名为 `queue: boolean`，由 `e.altKey || e.shiftKey` 赋值。
- **Commit 记录**：`feat(input): 追加路径兼容 Shift 和 Alt，字段重命名为 queue`

- **问题**：早期版本中 Raycaster 只设置了 `Layers.Target`。导致玩家将鼠标悬停在墙壁上时，射线会穿透墙壁命中后方的敌人或地雷，导致在墙面上出现悬停指示器。
- **解决**：
  1. 将 Raycaster 的检测层修改为 `Layers.Target | Layers.Terrain`。
  2. 在遍历相交结果时，按距离从近到远排序。如果拦截到的第一个物体属于 `Layers.Terrain`（如地形、掩体），则直接 `break` 中断检测。
  3. 这样确保了视线被墙体阻挡时，悬停必定失效。

## Day 3：任务 C 地雷爆炸与物理联调
- **完成**：任务 C 模块已支持加载 `level01.json` 所需的固定/随机地雷、工程兵探测器、排雷流程和延迟爆炸系统；主游戏场景接入由联调负责人后续统一安排。
- **完成**：地雷触发通过 `EventBus.mineTriggered` 进入 `MineExplosionSystem`，延迟 `0.8s` 后发送伤害和 `explosionImpulse`，避免触发时重复结算伤害。
- **完成**：`PhysicsWorld.applyExplosionImpulse()` 对爆炸半径内的动态刚体施加带距离衰减的径向冲量，并保留向上的抛掷分量；`Game` 监听 `explosionImpulse`，将事件接入物理世界。
- **完成**：布娃娃组件继续通过 `RagdollPhysicsAdapter.applyImpulse()` 作为物理边界；接入真实角色适配器后可复用同一爆炸事件，不修改 B/D 的伤害和角色状态接口。
- **验证**：`npm run build` 通过；手动验收路径为：加载关卡 → 工程兵进入探测扇区 → 地雷显示 → F 排雷 → 触发未排除地雷 → 等待 0.8 秒 → 观察 `damage` / `explosionImpulse` 事件和动态刚体冲量。

## Day 1 – Day 3：任务 B 地图、小队移动与战斗
- **Day 1 基础模块**：新增 `LevelBuilder` 负责校验/转换 `level01.json`；`SceneManager` 负责地面、掩体和地图标记；`UnitMovement` 提供确定性移动、追加路径、停止和强制移动接口；`SquadManager` 建立 `engineer`、`rifleman`、`machinegunner` 可用的小队状态容器。
- **Day 2 接口联调**：`SquadManager` 监听 `EventBus.moveCommand`，支持选中单位、普通移动、追加移动和 forceMine；`DamageSystem` 接入 `damage` 事件并维护 HP/倒地状态；`CombatSystem` 接入攻击、射击和敌人死亡事件；`attackHandler` 提供给 `InteractionManager` 使用的适配器。
- **Day 3 敌人和运行验证**：`EnemyAI` 支持巡逻点、近距离追击和与 `CombatSystem` 的敌人注册；地图/小队/战斗模块保持与 C 的地雷事件、D 的单位 ID 约定兼容。
- **验证**：`npm run build` 通过；核心 ID 保留为 `engineer`、`rifleman`、`machinegunner`、`E06`、`E08`。

## Day 4：任务 B 主循环联调与场景接入
- **主循环联调**：`Game` 通过 `Battle` 创建独立任务实例，在渲染更新中驱动小队移动、敌人 AI、玩家/敌方战斗、地雷、救援、占领和固定物理步进；重启/返回菜单使用销毁并重建，避免跨局状态泄漏。
- **地图与实体可视化**：`LevelBuilder` 从 `data/level01.json` 读取地图尺寸、掩体、电台、固定/随机地雷和敌人出生点；`SceneManager` 构建地面、掩体、电台、碰撞体和交互标记。三名玩家与 `E01`–`E08` 通过 `UnitVisual` 挂载到场景并保持位置、朝向和倒地可视状态同步。
- **输入与交互**：`SelectionSystem` 接入框选/点选和数字快捷选择；右键 `moveCommand` 支持队形移动、追加路径和工兵强制通过地雷；`InteractionManager` 发出 `interactionRequested`，由 `Battle` 路由攻击、排雷和救援，不改动 C/D 的事件接口。
- **验证**：`npm run build` 通过（TypeScript 检查及 Vite 生产构建均成功，59 modules transformed）；核心 ID `engineer`、`rifleman`、`machinegunner`、`E06`、`E08` 保持不变。

## Day 3：任务A 相机穿模与操作手感优化
- **问题背景**：在联调时发现，早期设计的相机防穿模射线（Occlusion）在角色走到树下时会被树叶遮挡，导致相机强行拉近，直接怼在角色脸上，严重影响视野和操作体验。
- **团队观察**：试玩过程中镜头忽远忽近导致强烈的 3D 眩晕感。
- **修改方案**：
  1. 在 `TacticalCamera.ts` 中彻底移除了防穿模射线检测，改为无条件保持设定的距离。
  2. 保留了 `InteractionManager` 中的鼠标悬停遮挡判定（墙后的敌人依然无法被集火）。
  3. 将 Q/E 旋转增加了 0.2s 的平滑 Lerp 插值，避免视角生硬跳变。
- **结果**：镜头跟随丝滑，不再受地形干扰。

## Day 5：外部 Playtest 反馈与改动（待填）
- 试玩者卡点 1：
- 试玩者卡点 2：
- 修复方案：

## Day 6：代表性 Commit 改动（待填）
- 改动内容：
