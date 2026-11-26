// Client 半：「设置 → 新闻日报」。
//
// 手写 lazy-CJS bundle：脚本执行时只注册 factory，模块体在 materialize 时才运行。
// 只依赖 React 与 DSH 既有服务（slots / remote），不引入 primitives。
//
// 这一页只做三件事：改设置（类别 / 定时 / 首次使用）、立刻出一份、回看历史日报。
// 真正的搜索由计划任务触发的那一轮 Agent 用 web_search 完成——客户端不抓网页。
//
// 一条重要约定：页面是「草稿 + 手动保存」的。凡是刷新（轮询、看日报、删日报）
// 都不能碰用户正在改的草稿；「现在出一份」也要先保存再做，否则出的还是旧设置。
window.__ModuleLoader__.load({
  id: "@skyrocks/dsh-news-digest",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    // Client 只声明调用形状；真正的校验在 Host 侧完成。
    const passThrough = () => ({ parse: (value) => value });
    const codec = (typeSymbol) => ({ mode: "strict", typeSymbol, create: passThrough });
    const parameter = (name) => ({ name, wire: name, source: "json", codec: codec(`@skyrocks/dsh-news-digest#${name}`) });

    const METHODS = ["status", "saveSettings", "report", "reports", "runNow", "openInBrowser"];
    const REMOTE = {
      package: "@skyrocks/dsh-news-digest",
      descriptors: METHODS.map((method) => ({
        id: `@skyrocks/dsh-news-digest#newsDigest/${method}`,
        service: "newsDigest",
        namespace: "newsDigest",
        method,
        invocation: { kind: "direct" },
        parameters: method === "status" ? [] : [parameter("request")],
        result: codec(`@skyrocks/dsh-news-digest#NewsDigest${method[0].toUpperCase()}${method.slice(1)}Result`)
      }))
    };

    const SOURCE_LABEL = {
      auto: "自动",
      schedule: "定时",
      "first-use": "上午第一次使用",
      manual: "手动",
      chat: "对话里"
    };

    // 触发判定的内部取值不进界面。
    const KIND_LABEL = {
      boot: "DSH 启动",
      prompt: "今天第一条消息",
      "report-exists": "今天已有日报"
    };

    const MAX_CUSTOM = 12;
    const MIN_ITEMS = 3;
    const MAX_ITEMS = 10;

    const CSS = [
      ".dsh-nd-section{display:flex;flex-direction:column;gap:12px;padding:4px 2px 24px;}",
      ".dsh-nd-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;}",
      ".dsh-nd-head h3{margin:0;font-size:13px;font-weight:600;}",
      ".dsh-nd-head-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}",
      ".dsh-nd-status{display:flex;flex-direction:column;gap:3px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary,#1f2329);}",
      ".dsh-nd-status-row{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;}",
      ".dsh-nd-status-key{color:var(--dsw-alias-label-tertiary,#8a8f98);min-width:44px;}",
      ".dsh-nd-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);line-height:1.6;overflow-wrap:anywhere;}",
      ".dsh-nd-card{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-module-platform,#fff);}",
      ".dsh-nd-card-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));}",
      ".dsh-nd-card-head h4{margin:0;font-size:11px;font-weight:600;letter-spacing:.04em;flex:1;min-width:0;color:var(--dsw-alias-label-tertiary,#8a8f98);}",
      ".dsh-nd-card-body{padding:12px;display:flex;flex-direction:column;gap:10px;}",
      ".dsh-nd-subhead{margin:2px 0 0;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);}",
      ".dsh-nd-group{display:flex;flex-direction:column;gap:8px;padding:10px 0 0;border-top:1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.16));}",
      ".dsh-nd-group:first-of-type{border-top:0;padding-top:0;}",
      ".dsh-nd-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
      ".dsh-nd-cat{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-bottom:1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.16));}",
      ".dsh-nd-cat:last-of-type{border-bottom:0;}",
      ".dsh-nd-cat-name{display:flex;align-items:center;gap:7px;min-width:150px;font-size:12.5px;color:var(--dsw-alias-label-primary,#1f2329);cursor:pointer;}",
      ".dsh-nd-cat-name input[type=checkbox]{width:14px;height:14px;}",
      ".dsh-nd-tag{padding:1px 6px;border-radius:999px;font-size:10px;line-height:16px;border:1px solid transparent;background:color-mix(in srgb,currentColor 8%,transparent);color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap;}",
      ".dsh-nd-cat input[type=text]{flex:1;min-width:120px;height:26px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:transparent;color:inherit;font-size:12px;}",
      ".dsh-nd-cat input[type=text]:focus-visible,.dsh-nd-inline input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:-1px;}",
      ".dsh-nd-cat.is-on .dsh-nd-cat-name{font-weight:600;}",
      ".dsh-nd-cat-remove{flex:none;margin-left:auto;}",
      ".dsh-nd-btn{height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:transparent;color:inherit;font-size:12px;cursor:pointer;}",
      ".dsh-nd-btn:hover{background:color-mix(in srgb,currentColor 8%,transparent);}",
      ".dsh-nd-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:1px;}",
      ".dsh-nd-btn:disabled{opacity:.5;cursor:default;}",
      ".dsh-nd-btn.is-primary{color:#fff;background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:transparent;}",
      ".dsh-nd-btn.is-danger{color:#fff;background:var(--dsw-alias-state-error-primary,#e5484d);border-color:transparent;}",
      ".dsh-nd-btn.is-link{height:24px;padding:0 6px;border-color:transparent;font-size:11.5px;color:var(--dsw-alias-state-business-primary,#4d6bfe);}",
      ".dsh-nd-btn.is-link.is-danger{color:var(--dsw-alias-state-error-primary,#e5484d);background:transparent;}",
      ".dsh-nd-inline{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329);flex-wrap:wrap;}",
      ".dsh-nd-inline input[type=time]{height:28px;padding:0 6px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:transparent;color:inherit;font-size:12px;}",
      ".dsh-nd-inline input[type=number]{height:28px;width:64px;padding:0 6px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:transparent;color:inherit;font-size:12px;}",
      ".dsh-nd-inline input[type=text]{height:28px;flex:1;min-width:160px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:transparent;color:inherit;font-size:12px;}",
      ".dsh-nd-switch{display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer;}",
      ".dsh-nd-switch input{width:14px;height:14px;}",
      ".dsh-nd-switch:focus-within{text-decoration:underline;text-underline-offset:3px;}",
      ".dsh-nd-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8f98);line-height:1.6;}",
      ".dsh-nd-list{display:flex;flex-direction:column;}",
      ".dsh-nd-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));}",
      ".dsh-nd-item:last-child{border-bottom:0;}",
      ".dsh-nd-item:hover{background:color-mix(in srgb,currentColor 4%,transparent);}",
      ".dsh-nd-item-main{flex:1;min-width:0;cursor:pointer;border-radius:7px;padding:3px 5px;}",
      ".dsh-nd-item-main:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:0;}",
      ".dsh-nd-item-title{font-size:12.5px;color:var(--dsw-alias-label-primary,#1f2329);display:flex;align-items:center;gap:6px;}",
      ".dsh-nd-item-title span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".dsh-nd-item-sub{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".dsh-nd-actions{display:flex;gap:2px;flex:none;align-items:center;}",
      ".dsh-nd-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-error-primary,#e5484d);flex:none;display:inline-block;}",
      ".dsh-nd-empty{padding:22px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8f98);line-height:1.9;}",
      ".dsh-nd-error{padding:8px 10px;border-radius:8px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-error-primary,#e5484d);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 10%,transparent);}",
      ".dsh-nd-ok{padding:8px 10px;border-radius:8px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-success-primary,#2f9e44);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2f9e44) 10%,transparent);}",
      ".dsh-nd-foot{display:flex;align-items:center;gap:8px;justify-content:flex-end;flex-wrap:wrap;}",
      ".dsh-nd-foot .dsh-nd-spacer{flex:1;}",
      ".dsh-nd-notice{position:fixed;right:20px;bottom:20px;z-index:2100;pointer-events:auto;width:min(360px,calc(100vw - 40px));border-radius:12px;padding:14px;background:var(--dsw-alias-bg-module-platform,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));box-shadow:0 14px 36px rgba(0,0,0,.24);color:var(--dsw-alias-label-primary,#1f2329);display:flex;flex-direction:column;gap:8px;}",
      ".dsh-nd-notice-head{display:flex;align-items:flex-start;gap:8px;}",
      ".dsh-nd-notice-title{flex:1;min-width:0;font-size:12.5px;font-weight:600;}",
      ".dsh-nd-notice-x{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:14px;line-height:1;cursor:pointer;padding:2px 4px;}",
      ".dsh-nd-notice-text{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary,#6b7280);max-height:66px;overflow:hidden;}",
      ".dsh-nd-notice-actions{display:flex;justify-content:flex-end;gap:8px;}",
    ].join("");

    function ensureStyle() {
      if (typeof document === "undefined") return () => {};
      const id = "dsh-nd-style";
      if (document.getElementById(id) !== null) return () => {};
      const element = document.createElement("style");
      element.id = id;
      element.textContent = CSS;
      document.head.appendChild(element);
      return () => {
        element.remove();
      };
    }

    let ctxRef = null;
    let mountReady = null;
    let mountError = null;

    async function call(method, argument) {
      await mountReady;
      if (mountError !== null) {
        throw new Error(`新闻日报服务没连上：${mountError instanceof Error ? mountError.message : String(mountError)}`);
      }
      const remote = ctxRef === null ? undefined : ctxRef.get("remote.newsDigest");
      if (remote === undefined || remote === null) throw new Error("新闻日报服务不可用");
      const result = argument === undefined ? await remote[method]() : await remote[method](argument);
      if (!result || result.ok === false) {
        const reason = result && result.error ? result.error.message || String(result.error) : "操作失败，请重试";
        throw new Error(reason);
      }
      return result.value;
    }

    function notify(text, success) {
      try {
        const menus = ctxRef === null ? undefined : ctxRef.get("contextMenus");
        if (menus !== undefined && typeof menus.notify === "function") menus.notify(text, success);
      } catch {
        // toast 不可用就静默；操作已经完成。
      }
    }

    function stamp(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value ?? "").slice(0, 16);
      const pad = (number) => String(number).padStart(2, "0");
      const sameYear = date.getFullYear() === new Date().getFullYear();
      const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      return `${sameYear ? day : `${date.getFullYear()}-${day}`} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function dayStamp(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      const pad = (number) => String(number).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function sourceLabel(source) {
      return SOURCE_LABEL[source] ?? "其他来源";
    }

    function clamp(value, min, max) {
      const number = Number(value);
      if (!Number.isFinite(number)) return min;
      return Math.min(Math.max(Math.round(number), min), max);
    }

    /** 设置的本地副本：保存前所有改动都留在这里。 */
    function draftOf(settings) {
      return JSON.parse(JSON.stringify({
        enabled: settings.enabled,
        focus: settings.focus,
        itemsPerCategory: settings.itemsPerCategory,
        categories: settings.categories,
        schedule: { enabled: settings.schedule.enabled, at: settings.schedule.at },
        firstUse: { ...settings.firstUse }
      }));
    }

    function sameDraft(a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    /** 下次会自动出报吗？给状态条用。 */
    function nextRunLabel(settings, taskExists) {
      if (!settings.enabled) return "已关掉，不会自动出报";
      if (!taskExists) return "还没有自动出报的任务，点「保存设置」或「现在出一份」会建好";
      if (settings.schedule.enabled) return `每天 ${settings.schedule.at}`;
      if (settings.firstUse.enabled) {
        return settings.firstUse.backfill
          ? "每天第一次用 DSH 时（错过上午也补）"
          : `每天上午 ${settings.firstUse.windowStart}–${settings.firstUse.windowEnd} 第一次用时`;
      }
      return "定时和第一次使用都关着，不会自动出报";
    }

    // ── 出报通知 ────────────────────────────────────────────────────────────
    //
    // 日报正文不再用弹框：新报告出现时在右下角推一张卡（有系统通知就一起弹），
    // 点「打开」用系统默认浏览器打开本地 HTML 页面（dsh-news-digest/reports/<日期>.html）。

    // 已经提示过的日报：关掉过的不再弹。
    const seenReports = new Set();
    let lastNewestId = null;

    function systemNotify(report) {
      try {
        if (typeof Notification === "undefined") return;
        if (Notification.permission !== "granted") {
          Notification.requestPermission?.();
          return;
        }
        const toast = new Notification("新闻日报", {
          body: report.overview === "" ? report.title : report.overview,
          tag: report.id
        });
        toast.onclick = () => {
          openReportInBrowser(report.id);
          toast.close();
        };
      } catch {
        // 系统通知不可用不影响页内卡片
      }
    }

    /** 打开失败的文案：旧进程没有这个接口时，说清楚要重启，而不是甩一串英文。 */
    function openFailureText(failure) {
      const raw = failure instanceof Error ? failure.message : String(failure ?? "");
      if (/is not a function|not found|unknown|no such|未注册|不存在|missing|undefined/i.test(raw)) {
        return "打开失败：当前 DSH 进程还是旧版本，没有「打开日报」接口。完全退出 DSH（⌘Q）后重新打开再试。";
      }
      return `打开失败：${raw}`;
    }

    /** 打开成功后让设置页立刻把红点刷掉，不用等 30 秒轮询。 */
    function announceOpened(id) {
      try {
        if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
          window.dispatchEvent(new CustomEvent("dsh-news-digest:opened", { detail: { id } }));
        }
      } catch {
        // 事件不可用不影响打开本身
      }
    }

    async function openReportInBrowser(id) {
      try {
        await call("openInBrowser", { id });
        announceOpened(id);
        notify("已在浏览器里打开", true);
      } catch (failure) {
        notify(openFailureText(failure), false);
      }
    }

    function NoticeCard() {
      const [notice, setNotice] = React.useState(null);

      React.useEffect(() => {
        let disposed = false;

        async function poll() {
          if (typeof document !== "undefined" && document.hidden === true) return;
          try {
            const value = await call("reports", { action: "list", limit: 5 });
            if (disposed) return;
            const list = Array.isArray(value.reports) ? value.reports : [];
            const newest = list.length === 0 ? null : list[0];
            if (newest === null) return;

            const isNewer = lastNewestId !== null && newest.id !== lastNewestId;
            // 首次加载：今天那份未读的报告也提示——早上出报时页面常常已经开着或刚打开。
            const todayKey = dayStamp(new Date());
            const firstLoadToday = lastNewestId === null
              && newest.unread === true
              && dayStamp(new Date(newest.createdAt)) === todayKey;
            if ((isNewer || firstLoadToday) && newest.unread === true && !seenReports.has(newest.id)) {
              seenReports.add(newest.id);
              setNotice(newest);
              systemNotify(newest);
            }
            lastNewestId = newest.id;
          } catch {
            // Host 还没就绪，等下一轮
          }
        }

        poll();
        const timer = setInterval(poll, 20000);
        const onVisible = () => {
          if (typeof document !== "undefined" && document.hidden !== true) poll();
        };
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
        if (typeof window !== "undefined") window.addEventListener("focus", onVisible);
        return () => {
          disposed = true;
          clearInterval(timer);
          if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
          if (typeof window !== "undefined") window.removeEventListener("focus", onVisible);
        };
      }, []);

      if (notice === null) return null;
      const dismiss = () => setNotice(null);
      return React.createElement(
        "div",
        { className: "dsh-nd-notice", role: "status" },
        React.createElement(
          "div",
          { className: "dsh-nd-notice-head" },
          React.createElement("div", { className: "dsh-nd-notice-title" }, notice.title),
          React.createElement("button", { type: "button", className: "dsh-nd-notice-x", "aria-label": "关掉这条提醒", onClick: dismiss }, "×")
        ),
        React.createElement(
          "div",
          { className: "dsh-nd-notice-text" },
          notice.overview === "" ? "新的一份已经生成，点开看看。" : notice.overview
        ),
        React.createElement(
          "div",
          { className: "dsh-nd-notice-actions" },
          React.createElement("button", { type: "button", className: "dsh-nd-btn is-link", onClick: dismiss }, "稍后"),
          React.createElement("button", {
            type: "button",
            className: "dsh-nd-btn is-primary",
            onClick: () => {
              void openReportInBrowser(notice.id);
              dismiss();
            }
          }, "打开")
        )
      );
    }

    // ── 设置页 ──────────────────────────────────────────────────────────────

    function Section() {
      const [status, setStatus] = React.useState(null);
      const [draft, setDraft] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [note, setNote] = React.useState("");
      const [busy, setBusy] = React.useState("");
      const [newName, setNewName] = React.useState("");
      const [confirmId, setConfirmId] = React.useState("");
      const [openError, setOpenError] = React.useState("");
      const dirtyRef = React.useRef(false);
      const watchRef = React.useRef(null);
      const seqRef = React.useRef(0);

      // 轮询只刷新状态；用户没保存的草稿一律不动。
      async function load(options) {
        const reset = options !== undefined && options.resetDraft === true;
        try {
          const value = await call("status");
          setStatus(value);
          if (reset || !dirtyRef.current) setDraft(draftOf(value.settings));
          setError(null);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      }

      function clearWatch() {
        if (watchRef.current !== null) {
          clearInterval(watchRef.current);
          watchRef.current = null;
        }
      }

      /** 出报是异步的：出完之后把列表刷出来，别让用户干等。 */
      function watchForReport(before) {
        clearWatch();
        let ticks = 0;
        watchRef.current = setInterval(async () => {
          ticks += 1;
          if (ticks > 24) {
            clearWatch();
            return;
          }
          try {
            const value = await call("status");
            const changed = value.counts.reports !== before.counts.reports
              || (value.todayReport === null ? "" : value.todayReport.createdAt) !== (before.todayReport === null ? "" : before.todayReport.createdAt);
            if (!changed) return;
            clearWatch();
            setStatus(value);
            if (!dirtyRef.current) setDraft(draftOf(value.settings));
            setNote("出好了，见下面「历史日报」。");
            notify("新闻日报已生成", true);
          } catch {
            // 下一轮再试
          }
        }, 5000);
      }

      React.useEffect(() => {
        load();
        const timer = setInterval(() => {
          if (typeof document !== "undefined" && document.hidden === true) return;
          load();
        }, 30000);
        // 通知卡里点开也会把红点刷掉。
        const onOpened = () => {
          load();
        };
        if (typeof window !== "undefined") window.addEventListener("dsh-news-digest:opened", onOpened);
        return () => {
          clearInterval(timer);
          clearWatch();
          if (typeof window !== "undefined") window.removeEventListener("dsh-news-digest:opened", onOpened);
        };
      }, []);

      const dirty = status !== null && draft !== null && !sameDraft(draft, draftOf(status.settings));
      dirtyRef.current = dirty;

      function patch(next) {
        setDraft((current) => (current === null ? current : { ...current, ...next }));
      }

      function setCategory(id, changes) {
        setDraft((current) => current === null ? current : {
          ...current,
          categories: current.categories.map((item) => (item.id === id ? { ...item, ...changes } : item))
        });
      }

      async function save() {
        if (draft === null) return;
        setBusy("save");
        setNote("");
        try {
          const value = await call("saveSettings", draft);
          setStatus(value);
          setDraft(draftOf(value.settings));
          setError(value.error === undefined || value.error === "" ? null : value.error);
          setNote("设置已保存。");
          notify("新闻日报设置已保存", true);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setBusy("");
        }
      }

      async function runNow() {
        if (draft === null) return;
        setBusy("run");
        setNote("");
        setError(null);
        try {
          // 先存：否则「现在出一份」用的是磁盘上的旧设置（勾了没保存 = 白勾）
          const saved = await call("saveSettings", draft);
          setStatus(saved);
          setDraft(draftOf(saved.settings));
          if (saved.error !== undefined && saved.error !== "") setError(saved.error);
          const value = await call("runNow", {});
          if (value.pending === true) {
            setNote("上一次还在跑，这次没有重复投递。");
            notify("上一次还在跑", false);
          } else if (saved.hasToday) {
            setNote("今天本来有一份，已经重新排上：出来后会覆盖上一份。");
            notify("已重新排上", true);
            watchForReport(saved);
          } else {
            setNote("已经排上了，正在出报…出来会出现在「历史日报」里。");
            notify("新闻日报：已经排上了", true);
            watchForReport(saved);
          }
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
          notify("出报失败", false);
        } finally {
          setBusy("");
        }
      }

      async function openReport(id) {
        setBusy("read");
        setOpenError("");
        try {
          await call("openInBrowser", { id });
          // 打开成功 = Host 已把它标成已读，这里先把红点抹掉，再拉一次对齐。
          setStatus((current) => current === null ? current : {
            ...current,
            reports: current.reports.map((item) => (item.id === id ? { ...item, unread: false } : item))
          });
          await load();
        } catch (failure) {
          const text = openFailureText(failure);
          setOpenError(text);
          notify(text, false);
        } finally {
          setBusy("");
        }
      }

      async function removeReport(id) {
        setBusy(`delete:${id}`);
        try {
          await call("reports", { action: "delete", id });
          setConfirmId("");
          notify("已删除这份日报", true);
          await load();
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setBusy("");
        }
      }

      function addCategory() {
        const name = newName.trim();
        if (name === "" || draft === null) return;
        if (draft.categories.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
          setError(`已经有「${name}」这个类别了。`);
          return;
        }
        if (draft.categories.filter((item) => item.custom).length >= MAX_CUSTOM) {
          setError(`自定义类别最多 ${MAX_CUSTOM} 个。`);
          return;
        }
        seqRef.current += 1;
        // 临时 id：保存时 Host 会按名字换成正式 id（tmp- 开头不会被落盘）
        patch({
          categories: [...draft.categories, {
            id: `tmp-${Date.now().toString(36)}-${seqRef.current}`,
            name: name.slice(0, 20),
            keywords: "",
            enabled: true,
            custom: true
          }]
        });
        setNewName("");
        setError(null);
      }

      function removeCategory(id) {
        if (draft === null) return;
        patch({ categories: draft.categories.filter((item) => item.id !== id) });
      }

      if (status === null || draft === null) {
        return React.createElement(
          "div",
          { className: "dsh-nd-section" },
          React.createElement("div", { className: "dsh-nd-head" }, React.createElement("h3", null, "新闻日报")),
          error === null
            ? React.createElement("div", { className: "dsh-nd-empty" }, "读取中…")
            : React.createElement(
                "div",
                { className: "dsh-nd-error", role: "alert" },
                error,
                React.createElement("div", { className: "dsh-nd-row" },
                  React.createElement("button", { type: "button", className: "dsh-nd-btn", onClick: () => load() }, "重试"))
              )
        );
      }

      const enabledCategories = draft.categories.filter((item) => item.enabled);
      const fixed = draft.categories.filter((item) => !item.custom);
      const custom = draft.categories.filter((item) => item.custom);
      const todayTitle = status.todayReport === null ? "" : status.todayReport.title;

      const categoryRow = (item) => React.createElement(
        "div",
        { className: item.enabled ? "dsh-nd-cat is-on" : "dsh-nd-cat", key: item.id },
        React.createElement(
          "label",
          { className: "dsh-nd-cat-name" },
          React.createElement("input", {
            type: "checkbox",
            checked: item.enabled === true,
            onChange: (event) => setCategory(item.id, { enabled: event.target.checked })
          }),
          item.name,
          item.custom ? React.createElement("span", { className: "dsh-nd-tag" }, "其他") : null
        ),
        React.createElement("input", {
          type: "text",
          value: item.keywords ?? "",
          maxLength: 100,
          "aria-label": `${item.name} 的搜索关键词`,
          placeholder: "可选关键词，例如：AI 芯片 半导体",
          onChange: (event) => setCategory(item.id, { keywords: event.target.value })
        }),
        item.custom
          ? React.createElement("button", {
              type: "button",
              className: "dsh-nd-btn is-link is-danger dsh-nd-cat-remove",
              onClick: () => removeCategory(item.id)
            }, "删除")
          : null
      );

      const customFull = custom.length >= MAX_CUSTOM;

      return React.createElement(
        "div",
        { className: "dsh-nd-section" },
        React.createElement(
          "div",
          { className: "dsh-nd-head" },
          React.createElement("h3", null, "新闻日报"),
          React.createElement(
            "div",
            { className: "dsh-nd-head-actions" },
            React.createElement("button", { type: "button", className: "dsh-nd-btn", disabled: busy !== "", onClick: runNow },
              busy === "run" ? "排队中…" : "现在出一份"),
            React.createElement("button", {
              type: "button",
              className: "dsh-nd-btn is-primary",
              disabled: busy !== "" || (!dirty && status.taskExists),
              onClick: save
            }, busy === "save" ? "保存中…" : "保存设置")
          )
        ),

        // 状态条：今天出了没有 / 下次什么时候
        React.createElement(
          "div",
          { className: "dsh-nd-status" },
          React.createElement(
            "div",
            { className: "dsh-nd-status-row" },
            React.createElement("span", { className: "dsh-nd-status-key" }, "今日"),
            React.createElement("span", null,
              status.hasToday ? `已出（${stamp(status.todayReport.createdAt)}）` : "还没有",
              draft.enabled ? "" : "（插件已关）",
              dirty ? " · 有未保存的改动" : ""),
            status.todayReport === null
              ? null
              : React.createElement("button", { type: "button", className: "dsh-nd-btn is-link", onClick: () => openReport(status.todayReport.id) }, "打开今天这份")
          ),
          React.createElement(
            "div",
            { className: "dsh-nd-status-row" },
            React.createElement("span", { className: "dsh-nd-status-key" }, "下次"),
            React.createElement("span", null, nextRunLabel(draft, status.taskExists))
          )
        ),
        error === null ? null : React.createElement("div", { className: "dsh-nd-error", role: "alert" }, error),
        note === "" ? null : React.createElement("div", { className: "dsh-nd-ok", role: "status" }, note),

        // 类别
        React.createElement(
          "div",
          { className: "dsh-nd-card" },
          React.createElement("div", { className: "dsh-nd-card-head" },
            React.createElement("h4", null, "类别"),
            React.createElement("span", { className: "dsh-nd-hint" }, `开着的 ${enabledCategories.length} 个`)),
          React.createElement(
            "div",
            { className: "dsh-nd-card-body" },
            React.createElement("div", { className: "dsh-nd-hint" }, "勾上就会每天搜这个方向；关键词可以不填，填了会拼进搜索词。"),
            ...fixed.map(categoryRow),
            React.createElement("div", { className: "dsh-nd-subhead" }, `其他（自定义，最多 ${MAX_CUSTOM} 个）`),
            custom.length === 0
              ? React.createElement("div", { className: "dsh-nd-hint" }, "还没有自定义类别。加一个你关心的方向，比如「AI」「加密货币」「本地」。")
              : null,
            ...custom.map(categoryRow),
            React.createElement(
              "div",
              { className: "dsh-nd-row" },
              React.createElement("input", {
                type: "text",
                value: newName,
                maxLength: 20,
                disabled: customFull,
                "aria-label": "新类别名",
                placeholder: customFull ? `已经有 ${MAX_CUSTOM} 个自定义类别了` : "新类别名，回车或点「加上」",
                onChange: (event) => setNewName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCategory();
                  }
                }
              }),
              React.createElement("button", { type: "button", className: "dsh-nd-btn", disabled: customFull, onClick: addCategory }, "加上")
            ),
            React.createElement(
              "div",
              { className: "dsh-nd-inline" },
              React.createElement("span", null, "每类最多"),
              React.createElement("input", {
                type: "number",
                min: MIN_ITEMS,
                max: MAX_ITEMS,
                "aria-label": "每类最多几条",
                value: draft.itemsPerCategory,
                onChange: (event) => patch({ itemsPerCategory: event.target.value === "" ? "" : Number(event.target.value) }),
                onBlur: () => patch({ itemsPerCategory: clamp(draft.itemsPerCategory, MIN_ITEMS, MAX_ITEMS) })
              }),
              React.createElement("span", null, `条（${MIN_ITEMS}–${MAX_ITEMS}）`)
            ),
            React.createElement(
              "div",
              { className: "dsh-nd-inline" },
              React.createElement("span", null, "额外关注"),
              React.createElement("input", {
                type: "text",
                value: draft.focus,
                maxLength: 300,
                "aria-label": "额外关注的方向",
                placeholder: "可选：最近在关注什么，会拼进搜索",
                onChange: (event) => patch({ focus: event.target.value })
              })
            )
          )
        ),

        // 什么时候出报
        React.createElement(
          "div",
          { className: "dsh-nd-card" },
          React.createElement("div", { className: "dsh-nd-card-head" }, React.createElement("h4", null, "什么时候出报")),
          React.createElement(
            "div",
            { className: "dsh-nd-card-body" },
            React.createElement(
              "label",
              { className: "dsh-nd-switch" },
              React.createElement("input", {
                type: "checkbox",
                checked: draft.enabled,
                onChange: (event) => patch({ enabled: event.target.checked })
              }),
              "打开新闻日报"
            ),

            React.createElement("div", { className: "dsh-nd-group" },
              React.createElement(
                "label",
                { className: "dsh-nd-switch" },
                React.createElement("input", {
                  type: "checkbox",
                  checked: draft.schedule.enabled,
                  onChange: (event) => patch({ schedule: { ...draft.schedule, enabled: event.target.checked } })
                }),
                "每天定时"
              ),
              React.createElement(
                "div",
                { className: "dsh-nd-inline" },
                React.createElement("input", {
                  type: "time",
                  value: draft.schedule.at,
                  "aria-label": "每天出报时间",
                  disabled: !draft.schedule.enabled,
                  onChange: (event) => {
                    const value = event.target.value;
                    patch({ schedule: { ...draft.schedule, at: value === "" ? draft.schedule.at : value } });
                  }
                }),
                React.createElement("span", { className: "dsh-nd-hint" }, "到点由 DSH 的定时任务触发；错过的那一次会在下次打开 DSH 时补")
              )
            ),

            React.createElement("div", { className: "dsh-nd-group" },
              React.createElement(
                "label",
                { className: "dsh-nd-switch" },
                React.createElement("input", {
                  type: "checkbox",
                  checked: draft.firstUse.enabled,
                  onChange: (event) => patch({ firstUse: { ...draft.firstUse, enabled: event.target.checked } })
                }),
                "每天第一次用 DSH 时补一次"
              ),
              React.createElement(
                "div",
                { className: "dsh-nd-inline" },
                React.createElement("span", null, "上午窗口"),
                React.createElement("input", {
                  type: "time",
                  value: draft.firstUse.windowStart,
                  "aria-label": "上午窗口开始",
                  disabled: !draft.firstUse.enabled,
                  onChange: (event) => {
                    const value = event.target.value;
                    patch({ firstUse: { ...draft.firstUse, windowStart: value === "" ? draft.firstUse.windowStart : value } });
                  }
                }),
                "—",
                React.createElement("input", {
                  type: "time",
                  value: draft.firstUse.windowEnd,
                  "aria-label": "上午窗口结束",
                  disabled: !draft.firstUse.enabled,
                  onChange: (event) => {
                    const value = event.target.value;
                    patch({ firstUse: { ...draft.firstUse, windowEnd: value === "" ? draft.firstUse.windowEnd : value } });
                  }
                })
              ),
              React.createElement(
                "label",
                { className: "dsh-nd-switch" },
                React.createElement("input", {
                  type: "checkbox",
                  checked: draft.firstUse.backfill,
                  disabled: !draft.firstUse.enabled,
                  onChange: (event) => patch({ firstUse: { ...draft.firstUse, backfill: event.target.checked } })
                }),
                "错过上午窗口也补（当天第一次用就补）"
              ),
              React.createElement("div", { className: "dsh-nd-hint" },
                "打开 DSH、或者当天第一条消息——哪个先到算哪个，一天只算一次；今天已经有日报就跳过。"
                + (draft.firstUse.windowStart === draft.firstUse.windowEnd ? "（起止时间相同 = 全天都算上午）" : ""))
            ),

            React.createElement("div", { className: "dsh-nd-hint" },
              `最近一次判定：${status.state.lastTriggerDay === ""
                ? "还没有"
                : `${status.state.lastTriggerAt === "" ? status.state.lastTriggerDay : stamp(status.state.lastTriggerAt)}（${KIND_LABEL[status.state.lastTriggerKind] ?? "未知原因"}）`}`
              + `${status.state.lastTriggerError === "" ? "" : ` · 上次失败：${status.state.lastTriggerError}`}`
              + `${status.state.retryDay === status.today && status.state.retryCount > 0 ? ` · 今天已自动补跑 ${status.state.retryCount} 次` : ""}`)
          )
        ),

        // 历史日报
        React.createElement(
          "div",
          { className: "dsh-nd-card" },
          React.createElement("div", { className: "dsh-nd-card-head" },
            React.createElement("h4", null, "历史日报"),
            React.createElement("span", { className: "dsh-nd-hint" },
              status.counts.reports > status.reports.length
                ? `共 ${status.counts.reports} 份，只显示最近 ${status.reports.length} 份`
                : `共 ${status.counts.reports} 份`)),
          openError === ""
            ? null
            : React.createElement("div", { className: "dsh-nd-error", role: "alert" }, openError),
          status.reports.length === 0
            ? React.createElement("div", { className: "dsh-nd-empty" }, "还没有日报。点右上角「现在出一份」，或者等定时 / 明天上午第一次用 DSH。")
            : React.createElement(
                "div",
                { className: "dsh-nd-list" },
                status.reports.map((item) => React.createElement(
                  "div",
                  { className: "dsh-nd-item", key: item.id },
                  React.createElement(
                    "div",
                    {
                      className: "dsh-nd-item-main",
                      role: "button",
                      tabIndex: 0,
                      "aria-label": `打开 ${item.title}`,
                      onClick: () => openReport(item.id),
                      onKeyDown: (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openReport(item.id);
                        }
                      }
                    },
                    React.createElement("div", { className: "dsh-nd-item-title" },
                      item.unread ? React.createElement("span", { className: "dsh-nd-dot", "aria-label": "未读", title: "未读" }) : null,
                      React.createElement("span", null, item.title)),
                    React.createElement("div", { className: "dsh-nd-item-sub" },
                      `${item.groups} 个类别 / ${item.items} 条 · ${sourceLabel(item.source)} · ${stamp(item.createdAt)}`
                      + `${item.overview === "" ? "" : ` · ${item.overview}`}`)
                  ),
                  React.createElement(
                    "div",
                    { className: "dsh-nd-actions" },
                    React.createElement("button", {
                      type: "button",
                      className: "dsh-nd-btn is-link",
                      disabled: busy !== "",
                      onClick: () => openReport(item.id)
                    }, "打开"),
                    confirmId === item.id
                      ? React.createElement(React.Fragment, null,
                          React.createElement("button", { type: "button", className: "dsh-nd-btn is-link is-danger", disabled: busy !== "", onClick: () => removeReport(item.id) }, "确定删除"),
                          React.createElement("button", { type: "button", className: "dsh-nd-btn is-link", onClick: () => setConfirmId("") }, "取消"))
                      : React.createElement("button", { type: "button", className: "dsh-nd-btn is-link is-danger", onClick: () => setConfirmId(item.id) }, "删除")
                  )
                ))
              )
        ),

        React.createElement(
          "div",
          { className: "dsh-nd-foot" },
          React.createElement("span", { className: "dsh-nd-hint" }, `数据在 ${status.dir}`),
          React.createElement("span", { className: "dsh-nd-spacer" }),
          dirty ? React.createElement("span", { className: "dsh-nd-hint" }, "有未保存的改动") : null,
          React.createElement("button", {
            type: "button",
            className: "dsh-nd-btn",
            disabled: !dirty || busy !== "",
            onClick: () => setDraft(draftOf(status.settings))
          }, "撤销改动")
        ),

      );
    }

    /** 设置页左侧导航里的图标（新闻日报）。 */
    function NewsGlyph(props) {
      const size = props !== null && typeof props === "object" && typeof props.size === "number" ? props.size : 16;
      return React.createElement(
        "svg",
        { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", focusable: "false" },
        React.createElement("path", {
          d: "M3.2 2.8h6.6l2.9 2.9v7.5H3.2zM9.6 2.9v3h3M5.4 6.6h3.4M5.4 9.1h5.2M5.4 11.4h3.6",
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinecap: "round",
          strokeLinejoin: "round"
        })
      );
    }

    function apply(ctx) {
      ctxRef = ctx;
      mountReady = ctx.remote.$mount(REMOTE).catch((error) => {
        mountError = error;
      });
      const slots = ctx.get("slots");
      if (slots === undefined) return;

      ctx.effect(() => ensureStyle());
      slots.inject("settings.section", () =>
        slots.register({ name: "settings.section", id: "news-digest", order: 46, label: () => "新闻日报" }, Section)
      );
      // 全局右下角通知：不在设置页时也能把新日报推出来。
      slots.inject("shell.overlay", () =>
        slots.register({ name: "shell.overlay", id: "news-digest.notice" }, NoticeCard)
      );

      // 设置页左侧导航的图标：不注册就是壳默认的齿轮。
      slots.inject("settings.section.icon", () =>
        slots.register({ name: "settings.section.icon", id: "news-digest", order: 46 }, NewsGlyph)
      );
    }

    exports.apply = apply;
    exports.inject = ["slots", "remote"];
    return module.exports;
  }
});
