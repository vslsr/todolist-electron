// SVN 演示动画 —— 用一步一步的动画讲清楚 SVN 的日常工作流。
// 每一课 = 一个初始状态 + 一串步骤；每个步骤用 apply() 修改状态，
// 因此任意一步的画面 = 初始状态叠加前 N 步，可随意前进 / 后退 / 跳转。

// ── 小工具 ────────────────────────────────────────────────────────────
const clone = o => JSON.parse(JSON.stringify(o));
const F = (name, status = '') => ({ name, status });
const wcFile = (s, n) => s.wc.files.find(f => f.name === n);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const REPO_URL = 'svn://192.168.1.8/proj';
const WC_PATH = 'D:\\work\\myproj';

// 前三个版本是所有课程共用的“历史包袱”
const BASE_REVS = [
  { n: 1, who: '张三', msg: '初始化项目骨架', files: ['A  main.cpp'] },
  { n: 2, who: '张三', msg: '添加 README 说明', files: ['A  README.md'] },
  { n: 3, who: '李四', msg: '修复启动崩溃', files: ['M  main.cpp'] },
];
const R4 = { n: 4, who: '我', msg: '调整血量上限，新增工具函数', files: ['M  main.cpp', 'A  util.cpp'] };
const R5 = { n: 5, who: '李四', msg: '新增关卡配置', files: ['A  level.json', 'M  README.md'] };
const R6 = { n: 6, who: '李四', msg: '补充部署说明', files: ['M  README.md'] };
const R7 = { n: 7, who: '我', msg: '更新说明文档', files: ['M  README.md'] };

const CONFLICT_RAW =
  '# 项目部署说明\n' +
  '\n' +
  '<<<<<<< .mine\n' +
  '运行 deploy.bat 即可一键部署到测试服。\n' +
  '=======\n' +
  '部署前请先确认 config.ini 里的服务器地址。\n' +
  '>>>>>>> .r6\n';

const CONFLICT_FIXED =
  '# 项目部署说明\n' +
  '\n' +
  '部署前请先确认 config.ini 里的服务器地址，\n' +
  '然后运行 deploy.bat 一键部署到测试服。\n';

// ── 课程数据 ──────────────────────────────────────────────────────────
const LESSONS = [
  // ① 检出 ------------------------------------------------------------
  {
    title: '① 检出',
    sub: 'svn checkout',
    intro: '版本库（repository）在服务器上，保存着项目的每一个历史版本。你的电脑上现在还什么都没有 —— 第一步是把它「检出」一份到本地。',
    init: { head: 3, revs: clone(BASE_REVS), tree: [{ name: 'main.cpp' }, { name: 'README.md' }], wc: null },
    steps: [
      {
        desc: '右边的版本库已经有 3 个版本。**版本号是整个版本库共用的**，不是每个文件各自一套 —— 任何人提交一次，版本号就 +1。左边你的电脑还是空的。',
      },
      {
        cmd: 'svn checkout svn://192.168.1.8/proj/trunk myproj',
        out: ['A    myproj/main.cpp', 'A    myproj/README.md', 'Checked out revision 3.'],
        anim: { dir: 'wc', label: 'checkout', files: ['main.cpp', 'README.md'] },
        desc: '检出 = 把版本库的内容下载一份到本地，这份副本叫**工作副本**（working copy）。它里面有个隐藏的 `.svn` 目录，记着「我是从哪个 URL、哪个版本来的」—— 别删它。',
        apply: s => { s.wc = { rev: 3, path: WC_PATH, files: [F('main.cpp'), F('README.md')] }; },
      },
      {
        cmd: 'svn info',
        out: ['Path: .', 'URL: svn://192.168.1.8/proj/trunk', 'Revision: 3', 'Last Changed Rev: 3'],
        desc: '工作副本版本 = 3，和版本库 HEAD 一致，说明你手上是最新的。**checkout 一个项目一辈子只做一次**，之后同步都用 `svn update`，再 checkout 一遍是新手最常见的浪费。',
      },
    ],
  },

  // ② 改动与提交 ------------------------------------------------------
  {
    title: '② 改动与提交',
    sub: 'status / add / commit',
    intro: '有了工作副本，就可以随便改了。SVN 不需要你提前「声明」要改哪个文件 —— 改完之后它自己能看出来。',
    init: {
      head: 3, revs: clone(BASE_REVS),
      tree: [{ name: 'main.cpp' }, { name: 'README.md' }],
      wc: { rev: 3, path: WC_PATH, files: [F('main.cpp'), F('README.md')] },
    },
    steps: [
      {
        cmd: '用编辑器打开 main.cpp，把血量上限改成 120',
        manual: true,
        desc: '直接改就行，不用先「签出」「锁定」。SVN 靠对比 `.svn` 里保存的原始副本来发现你改了什么。',
        apply: s => { wcFile(s, 'main.cpp').status = 'M'; },
      },
      {
        cmd: 'svn status',
        out: ['M       main.cpp'],
        desc: '`M` = Modified，本地改过、还没提交。**status 不联网**，纯本地对比，随时可以跑，是最该养成的习惯。',
      },
      {
        cmd: 'svn diff main.cpp',
        out: ['Index: main.cpp', '@@ -12,3 +12,4 @@', '     void Player::Init() {', '-        int hp = 100;', '+        int hp = 120;'],
        desc: '`diff` 看具体改了哪几行。`-` 开头是改之前的内容，`+` 开头是改之后的。**提交前先 diff 一遍**，能挡掉大部分「手滑把调试代码提上去」的事故。',
      },
      {
        cmd: '新建一个文件 util.cpp',
        manual: true,
        out: ['M       main.cpp', '?       util.cpp'],
        desc: '再次 status，新建的文件显示成 `?` —— **SVN 还不认识它**。这是新手最容易踩的坑：`?` 状态的文件在提交时会被直接跳过，你以为提交了，同事那边根本没有。',
        apply: s => { s.wc.files.push(F('util.cpp', '?')); },
      },
      {
        cmd: 'svn add util.cpp',
        out: ['A         util.cpp'],
        desc: 'add 把文件纳入版本控制，状态变成 `A`（Added）。注意 **add 只是在本地做个标记，文件并没有上传** —— 真正上传的是下一步的 commit。',
        apply: s => { wcFile(s, 'util.cpp').status = 'A'; },
      },
      {
        cmd: 'svn commit -m "调整血量上限，新增工具函数"',
        out: ['Sending        main.cpp', 'Adding         util.cpp', 'Transmitting file data ..done', 'Committing transaction...', 'Committed revision 4.'],
        anim: { dir: 'repo', label: 'commit', files: ['main.cpp', 'util.cpp'] },
        desc: '这才是真正的上传。版本库产生新版本 **r4**，工作副本版本也跟着变成 4，所有状态标记清空。`-m` 是提交说明，**不写会弹出编辑器**，Windows 上经常卡在 vi 里出不来。',
        apply: s => {
          s.head = 4; s.revs.push(clone(R4)); s.tree.push({ name: 'util.cpp' });
          s.wc.rev = 4; s.wc.files.forEach(f => f.status = '');
        },
      },
      {
        cmd: 'svn status',
        out: ['（没有任何输出）'],
        desc: 'status 什么都不输出 = 工作副本很干净，本地和版本库完全一致。**这是每天下班前应该看到的画面。**',
      },
    ],
  },

  // ③ 更新 ------------------------------------------------------------
  {
    title: '③ 更新',
    sub: 'svn update',
    intro: '你不动，不代表项目不动。团队里别人提交之后，你手上的工作副本就「过期」了 —— update 就是去把别人的成果拿过来。',
    init: {
      head: 4, revs: [...clone(BASE_REVS), clone(R4)],
      tree: [{ name: 'main.cpp' }, { name: 'README.md' }, { name: 'util.cpp' }],
      wc: { rev: 4, path: WC_PATH, files: [F('main.cpp'), F('README.md'), F('util.cpp')] },
    },
    steps: [
      {
        cmd: '与此同时，李四提交了他的关卡配置',
        manual: true,
        anim: { dir: 'top', label: '👤 李四 commit', files: ['level.json', 'README.md'] },
        desc: '**你什么都没做，但版本库变成 r5 了。**这就是集中式版本控制的日常：版本库是所有人共享的，随时会往前走。',
        apply: s => { s.head = 5; s.revs.push(clone(R5)); s.tree.push({ name: 'level.json' }); },
      },
      {
        cmd: 'svn status -u',
        out: ['        *        4   README.md', 'Status against revision:      5'],
        desc: '加上 `-u` 会**联网**跟版本库比一次。`*` 表示「服务器上有更新的版本」，也就是你**过期**（out of date）了。不加 `-u` 的 status 永远看不到这个星号。',
      },
      {
        cmd: 'svn update',
        out: ["Updating '.':", 'A    level.json', 'U    README.md', 'Updated to revision 5.'],
        anim: { dir: 'wc', label: 'update', files: ['level.json', 'README.md'] },
        desc: 'update 把版本库的新内容拉到本地：`A` 是新增的文件，`U` 是被更新的文件。**每天开工先 update，每次提交前也先 update** —— 这一个习惯能避免后面 90% 的麻烦。',
        apply: s => {
          s.wc.rev = 5;
          s.wc.files.splice(2, 0, F('level.json'));
        },
      },
    ],
  },

  // ④ 冲突 ------------------------------------------------------------
  {
    title: '④ 冲突与解决',
    sub: 'conflict / resolve',
    intro: '两个人改了同一个文件的同一块地方，就会冲突。这是 SVN 里唯一需要动脑子的场景，也是最值得看懂的一课。',
    init: {
      head: 5, revs: [...clone(BASE_REVS), clone(R4), clone(R5)],
      tree: [{ name: 'main.cpp' }, { name: 'README.md' }, { name: 'util.cpp' }, { name: 'level.json' }],
      wc: { rev: 5, path: WC_PATH, files: [F('main.cpp'), F('README.md'), F('level.json'), F('util.cpp')] },
    },
    steps: [
      {
        cmd: '你在 README.md 的部署章节写了一句话',
        manual: true,
        desc: '很普通的一次改动，状态 `M`。',
        apply: s => { wcFile(s, 'README.md').status = 'M'; },
      },
      {
        cmd: '不巧，李四也改了 README.md 的同一段，而且先提交了',
        manual: true,
        anim: { dir: 'top', label: '👤 李四 commit', files: ['README.md'] },
        desc: '版本库到了 **r6**。注意：你和他改的是**同一个文件的同一块内容** —— 冲突的种子就此埋下。如果改的是文件的不同位置，SVN 会自动合并，根本不会打扰你。',
        apply: s => { s.head = 6; s.revs.push(clone(R6)); },
      },
      {
        cmd: 'svn commit -m "更新说明文档"',
        fail: true,
        out: [
          'Sending        README.md',
          'svn: E155011: Commit failed (details follow):',
          "svn: E155011: File '/trunk/README.md' is out of date",
          'svn: E160028: File is out of date; try updating',
        ],
        desc: '提交被**拒绝**了。SVN 绝不允许你在旧版本的基础上覆盖别人的提交 —— 这是它保护数据的底线。看到 `out of date`，**不要慌，也不要重试**，照着提示先 update。',
      },
      {
        cmd: 'svn update',
        out: [
          "Updating '.':",
          "Conflict discovered in file 'README.md'.",
          'Select: (p) postpone, (mc) mine-conflict, (tc) theirs-conflict,',
          '        (s) show all options: p',
          'C    README.md',
          'Updated to revision 6.',
          'Summary of conflicts:',
          '  Text conflicts: 1',
        ],
        anim: { dir: 'wc', label: 'update', files: ['README.md'] },
        desc: 'SVN 会当场问你怎么办，**选 `p`（postpone，稍后处理）最稳妥** —— 先把冲突留在文件里，等会儿慢慢看。状态变成 `C` = Conflict。',
        apply: s => {
          s.wc.rev = 6;
          wcFile(s, 'README.md').status = 'C';
          s.wc.files.push(F('README.md.mine', '?'), F('README.md.r5', '?'), F('README.md.r6', '?'));
          s.conflict = { file: 'README.md', text: CONFLICT_RAW };
        },
      },
      {
        cmd: 'svn status',
        out: ['C       README.md', '?       README.md.mine', '?       README.md.r5', '?       README.md.r6'],
        desc: 'SVN 额外生成了 3 个文件当参考：`.mine` 是**你的**版本，`.r5` 是你俩分家前的**共同祖先**，`.r6` 是**李四的**版本。冲突解决后它们会自动删除，**不要手工去删**。',
      },
      {
        cmd: '打开 README.md，把内容改成你想要的最终样子',
        manual: true,
        desc: '文件里 `<<<<<<< .mine` 到 `=======` 之间是你写的，`=======` 到 `>>>>>>> .r6` 之间是李四写的。**你要做的是编辑出一个正确的结果，并删掉这三行标记** —— 通常两边的内容都有用，不是二选一。',
        apply: s => { s.conflict = { file: 'README.md', text: CONFLICT_FIXED, fixed: true }; },
      },
      {
        cmd: 'svn resolve --accept working README.md',
        out: ["Resolved conflicted state of 'README.md'"],
        desc: '告诉 SVN「我处理好了」。`--accept working` = 采用我当前编辑好的文件内容。**不执行这一步就无法提交。**（想整个文件全用我的：`--accept mine-full`；全听他的：`--accept theirs-full`。）',
        apply: s => {
          wcFile(s, 'README.md').status = 'M';
          s.wc.files = s.wc.files.filter(f => !f.name.startsWith('README.md.'));
          s.conflict = null;
        },
      },
      {
        cmd: 'svn commit -m "更新说明文档"',
        out: ['Sending        README.md', 'Transmitting file data .done', 'Committed revision 7.'],
        anim: { dir: 'repo', label: 'commit', files: ['README.md'] },
        desc: '这次成功了。**把这个套路背下来：提交被拒 → update → 手工改冲突 → resolve → 再提交。**遇到冲突不是你做错了什么，只是两个人碰巧改到了一起。',
        apply: s => {
          s.head = 7; s.revs.push(clone(R7));
          s.wc.rev = 7; s.wc.files.forEach(f => f.status = '');
        },
      },
    ],
  },

  // ⑤ 撤销与回看 ------------------------------------------------------
  {
    title: '⑤ 撤销与回看',
    sub: 'revert / log / merge -c',
    intro: '改崩了怎么办？已经提交出去的错误怎么收回？SVN 的历史是只增不删的 —— 撤销的本质是「再提交一个反向的版本」。',
    init: {
      head: 7, revs: [...clone(BASE_REVS), clone(R4), clone(R5), clone(R6), clone(R7)],
      tree: [{ name: 'main.cpp' }, { name: 'README.md' }, { name: 'util.cpp' }, { name: 'level.json' }],
      wc: { rev: 7, path: WC_PATH, files: [F('main.cpp'), F('README.md'), F('level.json'), F('util.cpp')] },
    },
    steps: [
      {
        cmd: '改 main.cpp 改崩了，想回到没动之前',
        manual: true,
        desc: '还没提交，属于「本地惨案」，最好收拾。',
        apply: s => { wcFile(s, 'main.cpp').status = 'M'; },
      },
      {
        cmd: 'svn revert main.cpp',
        out: ["Reverted 'main.cpp'"],
        desc: 'revert 用 `.svn` 里保存的原始副本**覆盖**你的文件 —— 不联网、瞬间完成。但请注意：**你的改动会永久消失，且没有后悔药**。全部还原用 `svn revert -R .`（R = 递归）。',
        apply: s => { wcFile(s, 'main.cpp').status = ''; },
      },
      {
        cmd: 'svn log -l 3',
        out: [
          '------------------------------------------------------------',
          'r7 | 我   | 2 lines',
          '   更新说明文档',
          'r6 | 李四 | 1 line',
          '   补充部署说明',
          'r5 | 李四 | 1 line',
          '   新增关卡配置',
        ],
        desc: '看提交历史。`-l 3` 只看最近 3 条，加 `-v` 还能列出每次改了哪些文件。**这就是为什么提交说明要写人话** —— 三个月后靠它找问题的是你自己。',
      },
      {
        cmd: 'svn diff -r 5:7 README.md',
        out: ['Index: README.md', '@@ -1,3 +1,5 @@', ' # 项目部署说明', '+部署前请先确认 config.ini 里的服务器地址，', '+然后运行 deploy.bat 一键部署到测试服。'],
        desc: '`-r 旧:新` 可以比较**任意两个历史版本**，不限于本地改动。想看某次提交本身干了什么，用 `svn diff -c 6`。',
      },
      {
        cmd: 'svn merge -c -6 .',
        out: ['--- Reverse-merging r6 into \'.\':', 'U    README.md'],
        desc: '要撤销**已经提交出去的 r6**：反向合并，`-c -6` 前面那个**负号**就是「倒着来」的意思。它把 r6 的改动从本地抹掉，变成一处普通的本地修改 `M`。',
        apply: s => { wcFile(s, 'README.md').status = 'M'; },
      },
      {
        cmd: 'svn commit -m "撤销 r6 的部署说明改动"',
        out: ['Sending        README.md', 'Committed revision 8.'],
        anim: { dir: 'repo', label: 'commit', files: ['README.md'] },
        desc: '注意：撤销的结果是**多出一个新版本 r8**，而不是把 r6 从历史里删掉。**SVN 从不真的删除历史** —— 这既是它的安全感来源，也意味着敏感信息一旦提交就很难彻底清除。',
        apply: s => {
          s.head = 8;
          s.revs.push({ n: 8, who: '我', msg: '撤销 r6 的部署说明改动', files: ['M  README.md'] });
          s.wc.rev = 8; s.wc.files.forEach(f => f.status = '');
        },
      },
    ],
  },

  // ⑥ 分支与合并 ------------------------------------------------------
  {
    title: '⑥ 分支与合并',
    sub: 'copy / switch / merge',
    intro: 'SVN 的分支不是什么特殊功能 —— 它就是一次目录拷贝。理解了这一点，trunk / branches / tags 这套目录约定就全通了。',
    init: {
      head: 8,
      revs: [...clone(BASE_REVS), clone(R4), clone(R5), clone(R6), clone(R7),
        { n: 8, who: '我', msg: '撤销 r6 的部署说明改动', files: ['M  README.md'] }],
      tree: [
        { name: 'trunk/', dir: true },
        { name: 'main.cpp', depth: 1 }, { name: 'README.md', depth: 1 },
        { name: 'util.cpp', depth: 1 }, { name: 'level.json', depth: 1 },
        { name: 'branches/', dir: true },
        { name: 'tags/', dir: true },
      ],
      wc: {
        rev: 8, path: WC_PATH, branch: 'trunk',
        files: [F('main.cpp'), F('README.md'), F('level.json'), F('util.cpp')],
      },
    },
    steps: [
      {
        desc: '版本库根目录下的三个目录纯属**约定**，SVN 本身并不认识它们：`trunk` 主干（随时可用的稳定版本）、`branches` 分支（并行开发）、`tags` 标签（发布快照）。',
      },
      {
        cmd: 'svn copy ^/trunk ^/branches/feature-hud -m "创建 HUD 功能分支"',
        out: ['Committed revision 9.'],
        anim: { dir: 'repo', label: 'copy', files: ['trunk → branches/'] },
        desc: '`^/` 是「版本库根目录」的简写。这是一次**服务器端拷贝**：不下载、不上传，瞬间完成，几乎不占空间（内部只存了个指针）。**分支 = 一个目录，就这么简单。**',
        apply: s => {
          s.head = 9;
          s.revs.push({ n: 9, who: '我', msg: '创建 HUD 功能分支', files: ['A  branches/feature-hud (from trunk:8)'] });
          s.tree.splice(6, 0, { name: 'feature-hud/', depth: 1, dir: true });
        },
      },
      {
        cmd: 'svn switch ^/branches/feature-hud',
        out: ["Updating '.':", "Updated to revision 9."],
        anim: { dir: 'wc', label: 'switch', files: ['feature-hud'] },
        desc: 'switch 把**现有工作副本**指向分支，不用重新 checkout 一份到另一个目录。之后的提交全部进分支，**trunk 不受任何影响**。想知道自己在哪个分支上：`svn info` 看 URL。',
        apply: s => { s.wc.rev = 9; s.wc.branch = 'branches/feature-hud'; },
      },
      {
        cmd: '开发 HUD 功能：改 main.cpp，新增 hud.cpp 并 add',
        manual: true,
        desc: '在分支上可以放心大胆地提交半成品，不会影响别人。',
        apply: s => {
          wcFile(s, 'main.cpp').status = 'M';
          s.wc.files.push(F('hud.cpp', 'A'));
        },
      },
      {
        cmd: 'svn commit -m "HUD 基础布局"',
        out: ['Sending        main.cpp', 'Adding         hud.cpp', 'Committed revision 10.'],
        anim: { dir: 'repo', label: 'commit', files: ['main.cpp', 'hud.cpp'] },
        desc: '这次提交进的是 `branches/feature-hud`，trunk 里依然没有 hud.cpp。**版本号仍然是全库共用的**，所以是 r10 而不是「分支的第 1 版」。',
        apply: s => {
          s.head = 10;
          s.revs.push({ n: 10, who: '我', msg: 'HUD 基础布局', files: ['M  branches/feature-hud/main.cpp', 'A  branches/feature-hud/hud.cpp'] });
          s.wc.rev = 10; s.wc.files.forEach(f => f.status = '');
        },
      },
      {
        cmd: 'svn switch ^/trunk',
        out: ["Updating '.':", 'U    main.cpp', 'D    hud.cpp', 'Updated to revision 10.'],
        anim: { dir: 'wc', label: 'switch', files: ['trunk'] },
        desc: '功能做完了，切回主干准备合并。注意 hud.cpp 从工作目录里消失了 —— 因为 trunk 里确实还没有它。**合并操作必须在「接收方」的工作副本里执行。**',
        apply: s => {
          s.wc.rev = 10; s.wc.branch = 'trunk';
          s.wc.files = s.wc.files.filter(f => f.name !== 'hud.cpp');
        },
      },
      {
        cmd: 'svn merge ^/branches/feature-hud',
        out: ["--- Merging r9 through r10 into '.':", 'U    main.cpp', 'A    hud.cpp', '--- Recording mergeinfo for merge of r9 through r10:', ' U   .'],
        anim: { dir: 'wc', label: 'merge', files: ['main.cpp', 'hud.cpp'] },
        desc: '把分支的改动合并进主干工作副本。**merge 只动本地，不会自动提交** —— 这是故意的，给你留出检查和跑测试的机会。合并如果撞车，处理方式和第 ④ 课的冲突一模一样。',
        apply: s => {
          wcFile(s, 'main.cpp').status = 'M';
          s.wc.files.push(F('hud.cpp', 'A'));
        },
      },
      {
        cmd: 'svn commit -m "合并 feature-hud 分支到主干"',
        out: ['Sending        .', 'Sending        main.cpp', 'Adding         hud.cpp', 'Committed revision 11.'],
        anim: { dir: 'repo', label: 'commit', files: ['main.cpp', 'hud.cpp'] },
        desc: '合并完成，功能进主干了。打发布标签同理：`svn copy ^/trunk ^/tags/v1.0 -m "发布 1.0"` —— **tag 和 branch 在技术上完全相同**，区别只是大家约定 tags 下面的东西不再修改。',
        apply: s => {
          s.head = 11;
          s.revs.push({ n: 11, who: '我', msg: '合并 feature-hud 分支到主干', files: ['M  trunk/main.cpp', 'A  trunk/hud.cpp'] });
          s.tree.splice(5, 0, { name: 'hud.cpp', depth: 1 });
          s.wc.rev = 11; s.wc.files.forEach(f => f.status = '');
        },
      },
    ],
  },
];

// ── 播放器状态 ────────────────────────────────────────────────────────
const TYPE_MS = 20;    // 每个字符的打字耗时
const FLY_MS = 1050;   // 数据包飞行耗时
const HOLD_MS = 2000;  // 自动播放时每步之后的停顿

let curLesson = 0;
let cur = -1;          // -1 = 课程开场画面
let playing = false;
let runToken = 0;      // 打断正在进行的动画
let playSession = 0;   // 打断自动播放循环

const $ = id => document.getElementById(id);
const speedVal = () => parseFloat($('speed').value);

// ── 文本渲染 ──────────────────────────────────────────────────────────
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = t => esc(t)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

const ST_WORD = { '': '', 'M': '已修改', 'A': '待新增', 'D': '待删除', 'C': '冲突！', '?': '未纳入版本控制' };
const ST_CLASS = { '': 's-', 'M': 'sM', 'A': 'sA', 'D': 'sD', 'C': 'sC', '?': 'sq' };
const ST_CHAR = { '': '·', 'M': 'M', 'A': 'A', 'D': 'D', 'C': 'C', '?': '?' };

// ── 状态推导 ──────────────────────────────────────────────────────────
function stateAt(lesson, idx) {
  const s = clone(lesson.init);
  for (let i = 0; i <= idx && i < lesson.steps.length; i++) {
    if (lesson.steps[i].apply) lesson.steps[i].apply(s);
  }
  return s;
}

// ── 画面渲染 ──────────────────────────────────────────────────────────
function renderState(s, prev) {
  // 工作副本
  const preKeys = new Set(prev && prev.wc ? prev.wc.files.map(f => f.name + '|' + f.status) : []);
  $('wc-path').textContent = s.wc ? s.wc.path : '（尚未检出）';
  $('wc-rev').textContent = s.wc ? 'r' + s.wc.rev : '—';

  const wcBody = $('wc-body');
  if (!s.wc) {
    wcBody.innerHTML = '<div class="empty">这台电脑上还没有工作副本。<br />先执行 <code>svn checkout</code>。</div>';
  } else {
    const branch = s.wc.branch
      ? `<div class="sec-label">当前分支 <span class="val">${esc(s.wc.branch)}</span></div>`
      : '<div class="sec-label">文件</div>';
    const rows = s.wc.files.map(f => {
      const flash = preKeys.size && !preKeys.has(f.name + '|' + f.status) ? ' flash' : '';
      const tmp = f.name.includes('.mine') || /\.r\d+$/.test(f.name) ? ' tmp' : '';
      return `<div class="file-row${flash}${tmp}">` +
        `<span class="st ${ST_CLASS[f.status]}">${ST_CHAR[f.status]}</span>` +
        `<span class="file-name">${esc(f.name)}</span>` +
        `<span class="st-word">${ST_WORD[f.status]}</span></div>`;
    }).join('');
    wcBody.innerHTML = branch + rows;
  }

  // 冲突预览
  const box = $('conflict-box');
  if (s.conflict) {
    box.style.display = '';
    $('cf-title').textContent = (s.conflict.fixed ? '✔ 手工改好的 ' : '⚠ 冲突文件 ') + s.conflict.file;
    $('cf-text').innerHTML = s.conflict.text.split('\n').map(line =>
      /^(<{7}|={7}|>{7})/.test(line) ? `<span class="mark">${esc(line)}</span>` : esc(line)
    ).join('\n');
  } else {
    box.style.display = 'none';
  }

  // 版本库
  $('repo-path').textContent = REPO_URL;
  $('repo-rev').textContent = 'HEAD r' + s.head;
  const preTree = new Set(prev ? prev.tree.map(t => t.name + (t.depth || 0)) : []);
  const tree = s.tree.map(t => {
    const flash = preTree.size && !preTree.has(t.name + (t.depth || 0)) ? ' flash' : '';
    const pad = (t.depth || 0) * 14;
    return `<div class="tree-row${t.dir ? ' dir' : ''}${flash}" style="padding-left:${7 + pad}px">` +
      `<span class="ico">${t.dir ? '📁' : '📄'}</span><span>${esc(t.name)}</span></div>`;
  }).join('');

  const preHead = prev ? prev.head : s.head;
  const revs = [...s.revs].reverse().map(r =>
    `<div class="rev${r.n > preHead ? ' flash' : ''}">` +
    `<div class="rev-top"><span class="rev-n">r${r.n}</span>` +
    `<span class="rev-msg">${esc(r.msg)}</span><span class="rev-who">${esc(r.who)}</span></div>` +
    `<div class="rev-files">${r.files.map(esc).join('<br />')}</div></div>`
  ).join('');

  $('repo-body').innerHTML =
    '<div class="sec-label">HEAD 内容</div><div class="tree">' + tree + '</div>' +
    '<div class="sec-label">版本历史（新→旧）</div>' + revs;
}

function renderDesc(step, lesson) {
  if (!step) {
    $('desc').innerHTML = `<div class="d-head">${esc(lesson.title)} · ${esc(lesson.sub)}</div>` +
      fmt(lesson.intro) + '<br /><br /><span style="color:#8a90a6">点击「▶ 播放」开始，或用 ← → 逐步查看。</span>';
    return;
  }
  $('desc').innerHTML = fmt(step.desc || '');
}

function renderTermFull(step) {
  const t = $('term');
  t.innerHTML = '';
  if (!step.cmd) {
    t.innerHTML = '<div class="line out">（这一步不需要敲命令，看右边的说明）</div>';
    return;
  }
  t.appendChild(cmdLine(step, step.cmd));
  appendOut(step);
}

function cmdLine(step, text) {
  const div = document.createElement('div');
  div.className = 'line ' + (step.manual ? 'note' : 'cmd');
  div.innerHTML = step.manual ? `✎ ${esc(text)}` : `<span class="prompt">$</span>${esc(text)}`;
  return div;
}

function appendOut(step) {
  const t = $('term');
  (step.out || []).forEach(l => {
    const d = document.createElement('div');
    d.className = 'line out' + (step.fail ? ' err' : '');
    d.textContent = l;
    t.appendChild(d);
  });
  t.scrollTop = t.scrollHeight;
}

function renderTimeline() {
  const steps = LESSONS[curLesson].steps;
  $('dots').innerHTML = steps.map((s, i) =>
    `<button class="dot-btn ${i === cur ? 'cur' : i < cur ? 'done' : ''}" data-i="${i}" ` +
    `title="${esc(s.cmd || s.desc.slice(0, 30))}">${i + 1}</button>`
  ).join('');
  $('step-count').textContent = `${cur + 1} / ${steps.length}`;
  $('prev-btn').disabled = cur < 0;
  $('next-btn').disabled = cur >= steps.length - 1;
}

function renderLessonList() {
  $('lesson-list').innerHTML = LESSONS.map((l, i) =>
    `<button class="lesson ${i === curLesson ? 'active' : ''}" data-i="${i}">` +
    `<div class="lesson-title">${esc(l.title)}</div>` +
    `<div class="lesson-sub">${esc(l.sub)}</div></button>`
  ).join('');
}

// ── 动画 ──────────────────────────────────────────────────────────────
function flyPacket(anim) {
  const p = $('packet');
  const dur = FLY_MS * speedVal();
  $('p-label').textContent = anim.label;
  $('p-files').innerHTML = anim.files.slice(0, 3).map(esc).join('<br />') +
    (anim.files.length > 3 ? '<br />…' : '');
  p.className = 'packet';
  void p.offsetWidth;                        // 重启动画
  p.style.setProperty('--dur', dur + 'ms');
  p.classList.add('fly-' + (anim.dir === 'repo' ? 'repo' : anim.dir === 'top' ? 'top' : 'wc'));
  if (anim.dir !== 'repo') p.classList.add('repo-color');

  // 通道里的箭头依次点亮
  const lane = anim.dir === 'repo' ? $('chev-repo') : $('chev-wc');
  const arrows = [...lane.children];
  const order = anim.dir === 'repo' ? arrows : [...arrows].reverse();
  order.forEach((el, i) => {
    setTimeout(() => el.classList.add('lit'), dur * 0.2 + i * dur * 0.16);
    setTimeout(() => el.classList.remove('lit'), dur * 0.2 + i * dur * 0.16 + dur * 0.4);
  });
}

// ── 播放控制 ──────────────────────────────────────────────────────────
async function goTo(idx, animate) {
  const token = ++runToken;
  const lesson = LESSONS[curLesson];
  cur = idx;
  renderTimeline();

  if (idx < 0) {
    renderState(stateAt(lesson, -1), null);
    $('term').innerHTML = '<div class="line out">（按 ▶ 播放开始演示）</div>';
    renderDesc(null, lesson);
    return;
  }

  const step = lesson.steps[idx];
  const pre = stateAt(lesson, idx - 1);
  const post = stateAt(lesson, idx);
  renderDesc(step, lesson);

  if (!animate) {
    renderState(post, pre);
    renderTermFull(step);
    return;
  }

  // 1. 先展示动作发生前的画面
  renderState(pre, null);
  $('term').innerHTML = '';

  // 2. 打字
  if (step.cmd) {
    const line = cmdLine(step, '');
    const caret = document.createElement('span');
    caret.className = 'caret';
    $('term').appendChild(line);
    const head = step.manual ? '✎ ' : null;
    for (let i = 1; i <= step.cmd.length; i++) {
      await sleep(TYPE_MS * speedVal());
      if (token !== runToken) return;
      const txt = step.cmd.slice(0, i);
      line.innerHTML = head ? `✎ ${esc(txt)}` : `<span class="prompt">$</span>${esc(txt)}`;
      line.appendChild(caret);
    }
    await sleep(260 * speedVal());
    if (token !== runToken) return;
    caret.remove();
  }

  // 3. 数据包飞过通道，中途切换到动作之后的画面
  if (step.anim) {
    flyPacket(step.anim);
    await sleep(FLY_MS * speedVal() * 0.68);
    if (token !== runToken) return;
    renderState(post, pre);
    appendOut(step);
    await sleep(FLY_MS * speedVal() * 0.32);
  } else {
    renderState(post, pre);
    appendOut(step);
  }
}

function setPlaying(v) {
  playing = v;
  $('play-btn').textContent = v ? '⏸ 暂停' : '▶ 播放';
}

function pause() {
  setPlaying(false);
  playSession++;
}

async function play() {
  const steps = LESSONS[curLesson].steps;
  if (cur >= steps.length - 1) await goTo(-1, false);   // 播完了就从头再来
  setPlaying(true);
  const ses = ++playSession;
  while (playing && ses === playSession) {
    if (cur >= steps.length - 1) break;
    await goTo(cur + 1, true);
    if (!playing || ses !== playSession) return;
    await sleep(HOLD_MS * speedVal());
    if (!playing || ses !== playSession) return;
  }
  if (ses === playSession) setPlaying(false);
}

function selectLesson(i) {
  pause();
  curLesson = i;
  renderLessonList();
  goTo(-1, false);
}

// ── 事件绑定 ──────────────────────────────────────────────────────────
$('lesson-list').addEventListener('click', e => {
  const btn = e.target.closest('.lesson');
  if (btn) selectLesson(+btn.dataset.i);
});

$('dots').addEventListener('click', e => {
  const btn = e.target.closest('.dot-btn');
  if (!btn) return;
  pause();
  goTo(+btn.dataset.i, false);
});

$('play-btn').addEventListener('click', () => { playing ? pause() : play(); });
$('next-btn').addEventListener('click', () => {
  pause();
  if (cur < LESSONS[curLesson].steps.length - 1) goTo(cur + 1, true);
});
$('prev-btn').addEventListener('click', () => {
  pause();
  if (cur >= 0) goTo(cur - 1, false);
});
$('replay-btn').addEventListener('click', async () => {
  pause();
  await goTo(-1, false);
  play();
});

$('sheet-btn').addEventListener('click', () => $('sheet').classList.remove('hidden'));
$('sheet-close').addEventListener('click', () => $('sheet').classList.add('hidden'));
$('sheet').addEventListener('click', e => {
  if (e.target === $('sheet')) $('sheet').classList.add('hidden');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('sheet').classList.add('hidden'); return; }
  if (e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); $('next-btn').click(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); $('prev-btn').click(); }
});

// ── 启动 ──────────────────────────────────────────────────────────────
renderLessonList();
goTo(-1, false);
