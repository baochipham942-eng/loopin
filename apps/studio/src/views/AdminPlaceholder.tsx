/**
 * 平台管理员端占位页：只兜底「尚未建设」的能力（当前仅收费与结算）+ 未知路由。
 * 已建：平台总览、主办方与白名单、全平台活动监控、集成配置中心、选题信号源、后台数据。
 */
export function AdminPlaceholder() {
  return (
    <section className="placeholder-card">
      <h2>该模块建设中</h2>
      <p className="muted">这块平台能力还在排期，尚未建设：</p>
      <ul className="placeholder-list">
        <li>收费与结算（单场工具费 / 票务抽成 / 订阅月费）——需新建账务模型</li>
      </ul>
      <p className="muted">
        其余平台能力已就位：平台总览、主办方与白名单、全平台活动监控、集成配置中心、选题信号源、后台数据。
      </p>
    </section>
  );
}
