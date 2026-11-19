# 发布清单（维护者用）

这份文件不随 tarball 发布，只用于把仓库整理成可公开的状态。

## 1. 发布前检查

```sh
npm test          # store / report / trigger / tools / manifest
for f in *.js; do node --check "$f"; done
```

- [ ] 版本号与 `CHANGELOG.md` 一致（当前 `0.1.0`）
- [ ] `README.md` 与当前界面一致（页签名、按钮名、「设置 → 新闻日报」）
- [ ] `package.json` 的 `repository` / `homepage` / `bugs` 指向 `skyrocks/dsh-news-digest`
- [ ] `engines.dsh` 与目标 DSH 版本匹配（`>=0.2.2-rc.2 <0.3.0`）
- [ ] `peerDependencies` 只有真正 import 的包（`react` / `cordis` / `typert-protocol`）
- [ ] `locale/*.json`、`docs/DETAIL.md`、`docs/preview.svg`、`icon.svg` 都在 `files` 里

## 2. 本地安装自测

```sh
cd ~/PrivateCode/dsh/dsh-news-digest
dsh plugin --profile desktop add "link:$PWD"
```

装完到「设置 → 新闻日报」：勾两个类别 → 「保存设置」→ 右上角「现在出一份」，
等「新闻日报」会话里出现日报；再回设置页点开「历史日报」确认能看、能删。
把定时改到两分钟后，确认到点会自己跑；把「每天第一次用 DSH」开关关掉再打开，确认状态行跟着变。

> 改 Host 侧（`index.js` / `service.js` / `store.js` / `report.js` / `schedule.js` / `trigger.js` /
> `tools.js` / `typert.host.js`）之后必须**完全退出 DSH 再打开**才生效——typert 接口清单只在进程启动时注册一次。
> 只改 `client.js` 时刷新页面即可。

## 3. 打包

```sh
npm pack
# 产物：skyrocks-dsh-news-digest-0.1.0.tgz
```

## 4. 发布

```sh
git add -A && git commit -m "release: 0.1.0"
git push origin main
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
gh release create v0.1.0 skyrocks-dsh-news-digest-0.1.0.tgz --title v0.1.0 --notes-file CHANGELOG.md
```

顺序要求：**先提交（含 CI）再打 tag**，否则 `main` 会比 tag 多一个 commit。

## 5. 曝光（发布才算完成）

```sh
gh repo edit skyrocks/dsh-news-digest \
  --add-topic dsh-plugin --add-topic deepseek-harness \
  --add-topic dsh --add-topic client-plugin \
  --add-topic news --add-topic digest
```

- topic 是生态雷达站全量扫描的唯一入口，漏打等于不可见。
- 自有索引 `skyrocks/dsh-plugins` 的 `index.json` 需要同步加条目，并把 `commit` pin 到本次 tag 的 commit。
- 推完索引后记得刷 jsDelivr：`https://purge.jsdelivr.net/gh/skyrocks/dsh-plugins@main/index.json`。

## 6. 已知边界

- 首次使用触发依赖 DSH 计划任务服务（`ctx.schedule`）；没有它的组合只能手动出报。
- 搜索是模型回合，会产生 token 消耗；断网时这一轮会失败，`state.json` 会记下 `lastTriggerError`。
