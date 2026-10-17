// 產品介紹頁的三語文案。網站對外連結集中在 LINKS，改網址只動這裡。
//
// 排版標記（由 page.ts 轉換）：
//   - 「|」只用在標題：標出允許換行的位置，段與段之間才能斷行，避免詞語被切開。
//   - nb()：專有名詞內的空格換成不換行空格，避免「Microsoft／Edge」被拆到兩行。
// 日文裡假名漢字與歐文之間不手打空格，間距交給 CSS text-autospace；台灣華語沿用手打半形空格。
export type SiteLang = 'zh-TW' | 'en' | 'ja';

export const LINKS = {
    store: 'https://chromewebstore.google.com/detail/fleet-chronometer-kancoll/akinifhdgdafifijckbbahfeoikkknip',
    source: 'https://gitlab.com/Syuan201/fleet-chronometer',
    privacy: 'https://gitlab.com/Syuan201/fleet-chronometer/-/blob/main/PRIVACY.md',
};

// 各語言頁面的路徑；根目錄是英文版，首次造訪會依瀏覽器語言導向。
export const PAGE_PATH: Record<SiteLang, string> = { en: '/', 'zh-TW': '/zh-tw/', ja: '/ja/' };

const nb = (s: string) => s.replace(/ /g, ' ');
const FC = nb('Fleet Chronometer');
const CWS_EN = nb('Chrome Web Store');
const EDGE = nb('Microsoft Edge');

export interface StepCopy { label: string; text: string }

export interface SiteCopy {
    htmlLang: string;
    langName: string;
    brand: string;
    title: string;
    description: string;
    nav: { demo: string; features: string; how: string; privacy: string; install: string };
    hero: { eyebrow: string; title: string; lead: string; store: string; demo: string; note: string };
    demo: {
        title: string; lead: string; next: string; auto: string; pause: string; restart: string;
        theme: string; loading: string; error: string; done: string; hint: string; frameTitle: string;
        steps: Record<string, StepCopy>;
    };
    features: { title: string; lead: string; items: { title: string; text: string }[] };
    how: { title: string; lead: string; alt: string };
    privacy: { title: string; items: { title: string; text: string }[] };
    install: { title: string; text: string; notice: string; store: string; source: string; privacyPolicy: string };
    footer: string;
}

export const COPY: Record<SiteLang, SiteCopy> = {
    'zh-TW': {
        htmlLang: 'zh-Hant-TW',
        langName: '繁體中文',
        brand: '航海鐘',
        title: '航海鐘 Fleet Chronometer — 艦隊これくしょん被動式作戰面板',
        description: '被動式的艦これ瀏覽器擴充：艦隊、遠征、入渠、基地航空隊、戰鬥預測與燃彈估算整合在一個面板，所有資料只存在你的瀏覽器。',
        nav: { demo: 'Demo', features: '功能', how: '運作原理', privacy: '隱私', install: '安裝' },
        hero: {
            eyebrow: '被動式艦これ輔助擴充',
            title: '一個面板，|看懂整支艦隊',
            lead: '航海鐘只觀察遊戲本來就收到的封包，把艦隊、遠征、入渠、基地航空隊、戰鬥預測與燃彈估算整合在同一個面板，並留下可查詢、可備份的本機紀錄。',
            store: '加到 Chrome',
            demo: '直接試玩 Demo',
            note: '免費、開源，資料只留在你的瀏覽器。',
        },
        demo: {
            title: '在瀏覽器裡|試一場出擊',
            lead: '這是擴充的正式面板，餵的是一段活動海域的實戰封包。按「下一步」逐一送出封包，看面板怎麼即時反應。面板裡的分頁、艦隊切換與展開都可以自由點。',
            next: '下一步',
            auto: '自動播放',
            pause: '暫停',
            restart: '重新開始',
            theme: '亮／暗',
            loading: '面板載入中…',
            error: 'Demo 載入失敗：',
            done: '這場出擊播放完畢。可以繼續點面板，或重新開始。',
            hint: 'Demo 的母港、裝備與時間是示意資料；戰鬥封包取自實際出擊。',
            frameTitle: '航海鐘面板 Demo',
            steps: {
                ready: { label: '母港', text: '目前在母港。上方是資材，可以切換遠征、入渠、建造與任務；下方是第一艦隊的血量、疲勞、補給與裝備。' },
                start: { label: '出擊：{node} 點', text: '艦隊出擊。面板自動切到出擊分頁，顯示目前海域、量表與這一路經過的節點。' },
                next: { label: '前往 {node} 點', text: '進入下一個節點。路線會依序記下，方便回頭確認走了哪一條路。' },
                battle: { label: '{node} 點戰鬥', text: '收到戰鬥封包的當下就算出各艦戰後血量、評價與 MVP 預測，不必等戰鬥動畫播完。' },
                airRaid: { label: '{node} 點空襲', text: '只有航空戰的節點也照樣預測損傷，並估算艦載機損耗。' },
                boss: { label: '{node} 點 Boss 戰', text: 'Boss 是敵聯合艦隊。基地航空隊、支援與各階段砲雷擊都會拆開顯示。' },
                night: { label: '{node} 點夜戰', text: '夜戰封包接著日戰計算，更新最終血量與評價預測。' },
                result: { label: '{node} 點結算', text: '結算封包到了，評價與掉落寫進出擊紀錄。' },
                port: { label: '回港', text: '回到母港，以母港封包校正血量與燃彈。切到「一般」分頁，可以看遠征與入渠倒數。' },
            },
        },
        features: {
            title: '功能',
            lead: '出擊當下要看的，與事後想查的，都在這裡。',
            items: [
                { title: '即時面板', text: '艦隊血量、疲勞、補給，遠征與入渠倒數（附通知），基地航空隊與關卡量表進度。' },
                { title: '戰鬥預測', text: '依遊戲送出的封包即時算出戰後血量、評價、MVP 與大破警告。' },
                { title: '燃彈估算', text: '出擊途中依節點類型估算消耗，回港後以實際數字校正。' },
                { title: '出擊紀錄', text: '一次出擊一張卡：路線、編成、逐節點細節、支援與基地航空隊波次，可匯出重播。' },
                { title: '資源紀錄', text: '八項資材整合在同一張折線圖，並統計各活動關卡的消耗區間。' },
                { title: '任務導覽', text: '追蹤任務進度與前置關係，條件和目前編成對照。' },
                { title: '艦娘與裝備全覽', text: '可篩選、可排序的完整收藏清單，附配裝參考。' },
                { title: '本機備份', text: '匯出到你指定的資料夾，附離線 HTML 檢視器，不裝擴充也能看重播。' },
            ],
        },
        how: {
            title: '運作原理',
            lead: '遊戲和伺服器之間照原本的方式通訊。航海鐘只讀取遊戲已經收到的回應副本，先刪掉登入 token，再於你的電腦上推算艦隊狀態與戰鬥預測。',
            alt: '遊戲與伺服器之間照原本方式通訊；航海鐘只讀取回應副本、刪除 token，資料全部留在瀏覽器的本機資料庫。',
        },
        privacy: {
            title: '隱私與安全，|從設計上保證',
            items: [
                { title: '只做被動觀察', text: '只觀察遊戲自己的流量，不重放、不修改、不代發任何請求，也不代替你操作遊戲。' },
                { title: '憑證不離開瀏覽器', text: '登入 token 在保存或傳遞之前就被剔除，永遠不會寫進資料庫。' },
                { title: '不上傳任何資料', text: '所有紀錄都存在瀏覽器本機的 IndexedDB，沒有後端伺服器。' },
                { title: '權限精簡', text: '安裝時不要求遊戲網站的存取權；只有在你按下視窗適應時才會詢問。' },
            ],
        },
        install: {
            title: '開始使用',
            text: `從 Chrome 線上應用程式商店安裝，打開遊戲後點擴充圖示即可開啟面板。${EDGE} 等 Chromium 瀏覽器同樣適用。`,
            notice: '本專案仍在公開測試，建議與其他輔助工具並行並交叉確認重要資訊；重要紀錄請自行備份。',
            store: '前往 Chrome 線上應用程式商店',
            source: '原始碼',
            privacyPolicy: '隱私權政策',
        },
        footer: '航海鐘是玩家自製的同人工具，與 DMM.com 及 Kadokawa Games 無任何關係，也未經其認可或贊助。「艦隊これくしょん -艦これ-」及遊戲素材版權皆屬原權利人。',
    },
    en: {
        htmlLang: 'en',
        langName: 'English',
        brand: 'Fleet Chronometer',
        title: 'Fleet Chronometer — a passive KanColle companion panel',
        description: 'A passive KanColle browser extension: fleets, expeditions, docking, land-based air, battle prediction and fuel/ammo estimates in one panel, with all data kept in your browser.',
        nav: { demo: 'Demo', features: 'Features', how: 'How it works', privacy: 'Privacy', install: 'Install' },
        hero: {
            eyebrow: 'A passive KanColle companion',
            title: 'Your whole fleet, one panel',
            lead: `${FC} only reads the responses the game already receives. Fleets, expeditions, docking, land-based air, battle prediction and fuel/ammo estimates sit in one panel, backed by a local history you can search and back up.`,
            store: nb('Add to Chrome'),
            demo: 'Try the demo',
            note: 'Free and open source. Your data stays in your browser.',
        },
        demo: {
            title: 'Run a sortie in your browser',
            lead: 'This is the extension’s real panel, fed with packets from an actual event-map sortie. Press Next to send them one by one and watch the panel react. Tabs, fleet switches and expandable rows are all clickable.',
            next: 'Next',
            auto: 'Auto play',
            pause: 'Pause',
            restart: 'Restart',
            theme: 'Light / Dark',
            loading: 'Loading panel…',
            error: 'Demo failed to load: ',
            done: 'That’s the whole sortie. Keep exploring the panel, or restart.',
            hint: 'The home port, equipment and timers are sample data; the battle packets come from a real sortie.',
            frameTitle: `${FC} panel demo`,
            steps: {
                ready: { label: 'Home port', text: 'You are at the home port. Resources sit on top, with tabs for expeditions, docking, construction and quests. Fleet 1’s HP, morale, supply and equipment are below.' },
                start: { label: 'Sortie: node {node}', text: 'The fleet sorties. The panel switches to the Sortie tab and shows the map, its gauge and the route so far.' },
                next: { label: 'To node {node}', text: 'Moving on. Each node is added to the route, so you can check which path you took.' },
                battle: { label: 'Battle at {node}', text: 'As soon as the battle packet arrives, the panel predicts post-battle HP, rank and MVP — no need to wait for the animation.' },
                airRaid: { label: 'Air raid at {node}', text: 'Air-only nodes are predicted too, including estimated aircraft losses.' },
                boss: { label: 'Boss at {node}', text: 'The boss is an enemy combined fleet. Land-based air, support and each shelling and torpedo phase are broken out.' },
                night: { label: 'Night battle at {node}', text: 'The night packet continues from the day battle and updates the final HP and rank prediction.' },
                result: { label: 'Result at {node}', text: 'The result packet arrives. Rank and drop are written to the sortie log.' },
                port: { label: 'Back to port', text: 'Back home, the port packet corrects HP and fuel/ammo. Open the General tab to see expedition and docking timers.' },
            },
        },
        features: {
            title: 'Features',
            lead: 'What you need mid-sortie, and what you want to look up later.',
            items: [
                { title: 'Live panel', text: 'Fleet HP, morale and supply, expedition and docking timers with notifications, land-based air and map gauges.' },
                { title: 'Battle prediction', text: 'Post-battle HP, rank, MVP and heavy-damage warnings, computed from the game’s own packets.' },
                { title: 'Fuel and ammo estimates', text: 'Estimated per node during a sortie, then corrected with the real numbers back at port.' },
                { title: 'Sortie log', text: 'One card per sortie: route, fleet, per-node detail, support and land-based air waves. Exportable as replays.' },
                { title: 'Resource log', text: 'All eight resources on one chart, with spending totals for each event map.' },
                { title: 'Quest guide', text: 'Tracks quest progress and prerequisites, and checks conditions against your current fleet.' },
                { title: 'Ship and equipment lists', text: 'Your full collection, filterable and sortable, plus an equipment reference.' },
                { title: 'Local backup', text: 'Export to a folder you choose, with an offline HTML viewer that plays replays without the extension.' },
            ],
        },
        how: {
            title: 'How it works',
            lead: `The game talks to its server exactly as it always does. ${FC} reads a copy of responses the game already received, strips the login token, and computes fleet state and battle predictions on your machine.`,
            alt: `The game and server communicate unchanged; ${FC} reads a copy of responses, removes the token, and keeps everything in the browser’s local database.`,
        },
        privacy: {
            title: 'Private and safe by design',
            items: [
                { title: 'Passive only', text: 'It observes the game’s own traffic. It never replays, modifies or sends requests, and never plays for you.' },
                { title: 'Credentials stay put', text: 'The login token is removed before anything is stored or passed along, and is never saved.' },
                { title: 'Nothing is uploaded', text: 'Every record lives in your browser’s IndexedDB. There is no backend server.' },
                { title: 'Minimal permissions', text: 'No access to the game site at install time; it asks only when you turn on window fitting.' },
            ],
        },
        install: {
            title: 'Get started',
            text: `Install it from the ${CWS_EN}, open the game, and click the extension icon to open the panel. It also works in ${EDGE} and other Chromium browsers.`,
            notice: 'The project is in public testing. Run it alongside another companion tool, cross-check important information, and back up records you care about.',
            store: `Open the ${CWS_EN}`,
            source: 'Source code',
            privacyPolicy: 'Privacy policy',
        },
        footer: `${FC} is a fan-made tool. It is not affiliated with, endorsed by, or sponsored by DMM.com or Kadokawa Games. “KanColle” and all game assets belong to their respective owners.`,
    },
    ja: {
        htmlLang: 'ja',
        langName: '日本語',
        brand: 'クロノメーター',
        title: 'クロノメーター Fleet Chronometer — 艦これ用の受動型パネル',
        description: '艦これ向けの受動型ブラウザ拡張。艦隊・遠征・入渠・基地航空隊・戦闘予測・燃料弾薬の見積りを1つのパネルにまとめ、データはすべてブラウザ内に保存します。',
        nav: { demo: 'デモ', features: '機能', how: '仕組み', privacy: 'プライバシー', install: '導入' },
        hero: {
            eyebrow: '艦これ向けの受動型補助拡張',
            title: '艦隊のすべてを、|1つのパネルに',
            lead: 'クロノメーターはゲームがすでに受け取った応答だけを読み取ります。艦隊・遠征・入渠・基地航空隊・戦闘予測・燃料弾薬の見積りを1つのパネルにまとめ、検索やバックアップができるローカル履歴を残します。',
            store: 'Chromeに追加',
            demo: 'デモを試す',
            note: '無料・オープンソース。データはブラウザの外に出ません。',
        },
        demo: {
            title: 'ブラウザで|出撃を体験',
            lead: 'これは拡張機能の正式なパネルで、イベント海域の実際の出撃パケットを流しています。「次へ」で1つずつ送り、パネルの反応を確かめてください。タブや艦隊の切り替え、展開もそのまま操作できます。',
            next: '次へ',
            auto: '自動再生',
            pause: '一時停止',
            restart: '最初から',
            theme: 'ライト／ダーク',
            loading: 'パネルを読み込み中…',
            error: 'デモを読み込めませんでした：',
            done: '出撃の再生が終わりました。パネルを引き続き操作するか、最初からやり直せます。',
            hint: '母港・装備・時刻は例示データです。戦闘パケットは実際の出撃から取っています。',
            frameTitle: 'クロノメーター パネルのデモ',
            steps: {
                ready: { label: '母港', text: '母港にいます。上部は資材で、遠征・入渠・建造・任務を切り替えられます。下は第1艦隊のHP・疲労・補給・装備です。' },
                start: { label: '出撃：{node}マス', text: '艦隊が出撃しました。パネルは出撃タブに切り替わり、海域・ゲージ・ここまでの航路を表示します。' },
                next: { label: '{node}マスへ', text: '次のマスへ進みます。航路は順に記録され、どのルートを通ったか後から確認できます。' },
                battle: { label: '{node}マスで戦闘', text: '戦闘パケットを受け取った時点で、戦闘後のHP・評価・MVPを予測します。演出を待つ必要はありません。' },
                airRaid: { label: '{node}マスで空襲', text: '航空戦のみのマスでも損害を予測し、艦載機の損耗を見積もります。' },
                boss: { label: '{node}マスでボス戦', text: 'ボスは敵連合艦隊です。基地航空隊・支援・各段階の砲雷撃を分けて表示します。' },
                night: { label: '{node}マスで夜戦', text: '夜戦パケットを昼戦の続きとして計算し、最終HPと評価の予測を更新します。' },
                result: { label: '{node}マスの戦闘結果', text: '戦闘結果のパケットが届き、評価とドロップが出撃ログに記録されます。' },
                port: { label: '帰投', text: '母港に戻り、母港パケットでHPと燃料弾薬を補正します。「一般」タブで遠征と入渠の残り時間を確認できます。' },
            },
        },
        features: {
            title: '主な機能',
            lead: '出撃中に見たいものも、あとで調べたいものも。',
            items: [
                { title: 'リアルタイムパネル', text: '艦隊のHP・疲労・補給、遠征と入渠のカウントダウン（通知付き）、基地航空隊、海域ゲージ。' },
                { title: '戦闘予測', text: 'ゲームが送るパケットから、戦闘後のHP・評価・MVP・大破警告を即座に算出。' },
                { title: '燃料弾薬の見積り', text: '出撃中はマスの種類から推定し、帰投後に実数で補正。' },
                { title: '出撃ログ', text: '出撃ごとに1枚のカード。ルート・編成・マスごとの詳細・支援と基地航空隊の波次を記録し、リプレイとして書き出し可能。' },
                { title: '資材ログ', text: '8種類の資材を1枚の折れ線グラフに。イベント海域ごとの消費区間も集計。' },
                { title: '任務ガイド', text: '任務の進捗と前提関係を追跡し、条件を現在の編成と照合。' },
                { title: '艦娘・装備一覧', text: 'フィルタ・ソートできる保有一覧と装備の参考表。' },
                { title: 'ローカルバックアップ', text: '任意のフォルダへ書き出し。拡張なしでリプレイを再生できるオフラインHTMLビューア付き。' },
            ],
        },
        how: {
            title: '仕組み',
            lead: 'ゲームとサーバーの通信はこれまでどおりです。クロノメーターはゲームが受け取った応答のコピーだけを読み、ログインtokenを削除したうえで、艦隊の状態と戦闘予測を手元の端末で計算します。',
            alt: 'ゲームとサーバーの通信はそのまま。クロノメーターは応答のコピーを読み取り、tokenを削除し、すべてをブラウザのローカルデータベースに保存します。',
        },
        privacy: {
            title: '設計段階から守る|プライバシーと安全',
            items: [
                { title: '受動的な観測のみ', text: 'ゲーム自身の通信を観測するだけです。リクエストの再送・改変・代理送信も、自動操作も行いません。' },
                { title: '認証情報は外に出ない', text: 'ログインtokenは保存や受け渡しの前に削除され、保存されることはありません。' },
                { title: 'アップロードなし', text: '記録はすべてブラウザのIndexedDBに保存されます。バックエンドサーバーはありません。' },
                { title: '最小限の権限', text: 'インストール時にゲームサイトへのアクセスは求めません。ウィンドウ適応を使うときだけ確認します。' },
            ],
        },
        install: {
            title: '導入方法',
            text: `Chromeウェブストアからインストールし、ゲームを開いて拡張機能のアイコンをクリックするとパネルが開きます。${EDGE}などのChromium系ブラウザでも使えます。`,
            notice: '本プロジェクトは公開テスト中です。他の補助ツールと併用して重要な情報を相互確認し、大切な記録はご自身でバックアップしてください。',
            store: 'Chromeウェブストアを開く',
            source: 'ソースコード',
            privacyPolicy: 'プライバシーポリシー',
        },
        footer: 'クロノメーターはファンによる非公式ツールであり、DMM.comおよび角川ゲームスとは一切関係なく、公認・後援も受けていません。「艦隊これくしょん -艦これ-」およびゲーム内素材の著作権は各権利者に帰属します。',
    },
};
