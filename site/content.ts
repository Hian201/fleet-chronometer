// 產品介紹頁的三語文案。網站對外連結集中在 LINKS，改網址只動這裡。
//
// 排版標記（由 page.ts 轉換）：
//   - 「|」只用在標題：標出允許換行的位置，段與段之間才能斷行，避免詞語被切開。
//   - nb()：專有名詞內的空格換成不換行空格，避免「Microsoft／Edge」被拆到兩行。
// 日文裡假名漢字與歐文之間不手打空格，間距交給 CSS text-autospace；台灣華語沿用手打半形空格。
export type SiteLang = 'zh-TW' | 'en' | 'ja';

export const LINKS = {
    store: 'https://chromewebstore.google.com/detail/fleet-chronometer-kancoll/akinifhdgdafifijckbbahfeoikkknip',
    // 聯絡信箱與商店頁的開發人員聯絡信箱相同。
    contact: 'mailto:yisyuan201@gmail.com',
    // 原始碼只連 GitHub；「不干涉通訊」一節逐檔連到觀察器與測試，讓讀者自行查證。
    repo: 'https://github.com/Hian201/fleet-chronometer',
    // 隱私權政策由 PRIVACY.md 建置成站內頁（site/privacy.ts），商店的隱私權政策網址也指向這裡。
    privacy: '/privacy/',
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
    nav: { demo: string; features: string; trust: string; install: string };
    hero: { tagline: string; store: string; demo: string; note: string; changelog: string };
    demo: {
        title: string; lead: string; next: string; auto: string; pause: string; restart: string;
        theme: string; loading: string; error: string; done: string; hint: string; frameTitle: string;
        steps: Record<string, StepCopy>;
    };
    // 截圖標註：notes 依序對應 page.ts SHOT_MARKS 的編號位置。
    highlights: { title: string; lead: string; shots: Record<'port' | 'sortie', { title: string; text: string; alt: string; notes: string[] }> };
    more: { title: string; lead: string; items: { title: string; text: string }[] };
    trust: {
        title: string; lead: string; alt: string; items: { title: string; text: string }[];
        sourceTitle: string; sources: { path: string; text: string }[];
    };
    install: { title: string; text: string; notice: string; store: string; contact: string; privacyPolicy: string };
    // 更新紀錄頁（site/changelog.ts）：內容來自各語言的 CHANGELOG 檔，只顯示已發布的版本。
    changelog: { title: string; lead: string; back: string };
    footer: string;
}

export const COPY: Record<SiteLang, SiteCopy> = {
    'zh-TW': {
        htmlLang: 'zh-Hant-TW',
        langName: '繁體中文',
        brand: '航海鐘',
        title: '航海鐘 Fleet Chronometer — 艦隊これくしょん被動式作戰面板',
        description: '被動式的艦これ瀏覽器擴充：艦隊、遠征、入渠、基地航空隊、戰鬥預測與燃彈估算整合在一個面板，所有資料只存在你的瀏覽器。',
        nav: { demo: 'Demo', features: '功能', trust: '不干涉通訊', install: '安裝' },
        hero: {
            tagline: '只讀封包、不碰遊戲的|艦隊作戰面板',
            store: '加到 Chrome',
            demo: '試玩 Demo',
            note: '免費、開源，資料只留在你的瀏覽器。',
            changelog: '更新紀錄',
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
        highlights: {
            title: '面板上看得到什麼',
            lead: '以下是 Demo 面板的實際畫面，編號對應右側說明。',
            shots: {
                port: {
                    title: '母港：出擊前的整備',
                    text: '回到母港就能一次確認資材、倒數與艦隊狀態。',
                    alt: '面板的母港畫面：資材、遠征倒數與第一艦隊各艦的狀態。',
                    notes: [
                        '八項資材一列看完。',
                        '遠征、入渠、建造倒數，時間到發出通知。',
                        '切換艦隊、聯合艦隊與基地航空隊。',
                        '制空、判定式(33) 索敵、航速、合計等級與 TP。',
                        '各艦血量、疲勞、燃彈剩餘與裝備。',
                    ],
                },
                sortie: {
                    title: '出擊：戰鬥一開始就知道結果',
                    text: '收到戰鬥封包的當下就算完，不必等戰鬥動畫播完。',
                    alt: '面板的出擊畫面：關卡量表、路線、戰鬥評價預測與各艦戰後血量。',
                    notes: [
                        '海域、量表剩餘與這一路走過的節點。',
                        '制空狀態與交戰形態。',
                        '預測勝敗評價與雙方陣形。',
                        '敵艦編成與擊沉狀況。',
                        '戰後血量預測，中破、大破一眼可見。',
                        '燃料與彈藥剩餘，途中依節點估算消耗。',
                    ],
                },
            },
        },
        more: {
            title: '情報總括：事後查詢',
            lead: '面板之外，另有一頁完整的紀錄與查詢。',
            items: [
                { title: '出擊紀錄', text: '一次出擊一張卡：路線、編成、逐節點細節、支援與基地航空隊波次，可匯出重播。' },
                { title: '資源紀錄', text: '八項資材整合在同一張折線圖，並統計各活動關卡的消耗區間。' },
                { title: '任務導覽', text: '追蹤任務進度與前置關係，條件和目前編成對照。' },
                { title: '艦娘與裝備全覽', text: '可篩選、可排序的完整收藏清單，附配裝參考。' },
                { title: '本機備份', text: '匯出到你指定的資料夾，附離線 HTML 檢視器，不裝擴充也能看重播。' },
            ],
        },
        trust: {
            title: '不干涉遊戲通訊',
            lead: '遊戲和伺服器之間照原本的方式通訊。航海鐘只讀取遊戲已經收到的回應副本，先刪掉登入 token，再於你的電腦上推算艦隊狀態與戰鬥預測。',
            alt: '遊戲與伺服器之間照原本方式通訊；航海鐘只讀取回應副本、刪除 token，資料全部留在瀏覽器的本機資料庫。',
            items: [
                { title: '只做被動觀察', text: '不重放、不修改、不代發任何請求，也不代替你操作遊戲。' },
                { title: '憑證不離開瀏覽器', text: '登入 token 在保存或傳遞之前就被剔除，永遠不會寫進資料庫。' },
                { title: '不上傳任何資料', text: '所有紀錄都存在瀏覽器本機的 IndexedDB，沒有後端伺服器。' },
                { title: '權限精簡', text: '安裝時不要求遊戲網站的存取權；只有在你按下視窗適應時才會詢問。' },
            ],
            sourceTitle: '想自己確認，可以直接看這幾個檔案：',
            sources: [
                { path: 'entrypoints/interceptor.content.ts', text: '只掛在遊戲 axios 的回應攔截器，讀取回應副本。' },
                { path: 'entrypoints/bridge.content.ts', text: '確認來源並刪除登入 token，再交給背景程式。' },
                { path: 'tests/interceptor-capture.test.ts', text: '測試確保不取代 fetch 與 XMLHttpRequest。' },
            ],
        },
        install: {
            title: '開始使用',
            text: `從 Chrome 線上應用程式商店安裝，打開遊戲後點擴充圖示即可開啟面板。${EDGE} 等 Chromium 瀏覽器同樣適用。`,
            notice: '本專案仍在公開測試，建議與其他輔助工具並行並交叉確認重要資訊；重要紀錄請自行備份。',
            store: '前往 Chrome 線上應用程式商店',
            contact: '聯絡開發者',
            privacyPolicy: '隱私權政策',
        },
        changelog: { title: '更新紀錄', lead: '各版本在 Chrome 線上應用程式商店發布時的變更。', back: '回到首頁' },
        footer: '航海鐘是玩家自製的同人工具，與 DMM.com 及 Kadokawa Games 無任何關係，也未經其認可或贊助。「艦隊これくしょん -艦これ-」及遊戲素材版權皆屬原權利人。',
    },
    en: {
        htmlLang: 'en',
        langName: 'English',
        brand: 'Fleet Chronometer',
        title: 'Fleet Chronometer — a passive KanColle companion panel',
        description: 'A passive KanColle browser extension: fleets, expeditions, docking, land-based air, battle prediction and fuel/ammo estimates in one panel, with all data kept in your browser.',
        nav: { demo: 'Demo', features: 'Features', trust: 'No interference', install: 'Install' },
        hero: {
            tagline: 'A passive KanColle panel that reads packets and never touches the game.',
            store: nb('Add to Chrome'),
            demo: 'Try the demo',
            note: 'Free and open source. Your data stays in your browser.',
            changelog: 'Changelog',
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
        highlights: {
            title: 'What the panel shows',
            lead: 'Real screens from the demo panel. Numbers match the notes alongside.',
            shots: {
                port: {
                    title: 'At port: ready for the next sortie',
                    text: 'Resources, timers and fleet condition, all in one look.',
                    alt: 'The panel at port: resources, expedition timers and the state of each ship in Fleet 1.',
                    notes: [
                        'All eight resources on one row.',
                        'Expedition, docking and construction timers, with notifications.',
                        'Switch fleets, the combined fleet and land-based air.',
                        'Fighter power, LoS (formula 33), speed, total level and TP.',
                        'HP, morale, fuel and ammo left, and equipment for each ship.',
                    ],
                },
                sortie: {
                    title: 'In battle: know the outcome right away',
                    text: 'Everything is computed the moment the battle packet arrives — no need to wait for the animation.',
                    alt: 'The panel during a sortie: map gauge, route, predicted battle rank and post-battle HP for each ship.',
                    notes: [
                        'Map, remaining gauge and the nodes you passed.',
                        'Air state and engagement.',
                        'Predicted rank and both formations.',
                        'Enemy fleet and which ships were sunk.',
                        'Predicted post-battle HP, with medium and heavy damage at a glance.',
                        'Fuel and ammo left, estimated per node during the sortie.',
                    ],
                },
            },
        },
        more: {
            title: 'Overview: look it up later',
            lead: 'Beyond the panel, a full page of records and lookups.',
            items: [
                { title: 'Sortie log', text: 'One card per sortie: route, fleet, per-node detail, support and land-based air waves. Exportable as replays.' },
                { title: 'Resource log', text: 'All eight resources on one chart, with spending totals for each event map.' },
                { title: 'Quest guide', text: 'Tracks quest progress and prerequisites, and checks conditions against your current fleet.' },
                { title: 'Ship and equipment lists', text: 'Your full collection, filterable and sortable, plus an equipment reference.' },
                { title: 'Local backup', text: 'Export to a folder you choose, with an offline HTML viewer that plays replays without the extension.' },
            ],
        },
        trust: {
            title: 'No interference with the game',
            lead: `The game talks to its server exactly as it always does. ${FC} reads a copy of responses the game already received, strips the login token, and computes fleet state and battle predictions on your machine.`,
            alt: `The game and server communicate unchanged; ${FC} reads a copy of responses, removes the token, and keeps everything in the browser’s local database.`,
            items: [
                { title: 'Passive only', text: 'It never replays, modifies or sends requests, and never plays for you.' },
                { title: 'Credentials stay put', text: 'The login token is removed before anything is stored or passed along, and is never saved.' },
                { title: 'Nothing is uploaded', text: 'Every record lives in your browser’s IndexedDB. There is no backend server.' },
                { title: 'Minimal permissions', text: 'No access to the game site at install time; it asks only when you turn on window fitting.' },
            ],
            sourceTitle: 'Want to check for yourself? These are the files to read:',
            sources: [
                { path: 'entrypoints/interceptor.content.ts', text: 'Hooks only the game’s axios response interceptor and reads a copy of each response.' },
                { path: 'entrypoints/bridge.content.ts', text: 'Checks the origin and removes the login token before passing data on.' },
                { path: 'tests/interceptor-capture.test.ts', text: 'Tests that fetch and XMLHttpRequest are never replaced.' },
            ],
        },
        install: {
            title: 'Get started',
            text: `Install it from the ${CWS_EN}, open the game, and click the extension icon to open the panel. It also works in ${EDGE} and other Chromium browsers.`,
            notice: 'The project is in public testing. Run it alongside another companion tool, cross-check important information, and back up records you care about.',
            store: `Open the ${CWS_EN}`,
            contact: 'Contact',
            privacyPolicy: 'Privacy policy',
        },
        changelog: { title: 'Changelog', lead: `Changes in each release on the ${CWS_EN}.`, back: 'Back to home' },
        footer: `${FC} is a fan-made tool. It is not affiliated with, endorsed by, or sponsored by DMM.com or Kadokawa Games. “KanColle” and all game assets belong to their respective owners.`,
    },
    ja: {
        htmlLang: 'ja',
        langName: '日本語',
        brand: 'クロノメーター',
        title: 'クロノメーター Fleet Chronometer — 艦これ用の受動型パネル',
        description: '艦これ向けの受動型ブラウザ拡張。艦隊・遠征・入渠・基地航空隊・戦闘予測・燃料弾薬の見積りを1つのパネルにまとめ、データはすべてブラウザ内に保存します。',
        nav: { demo: 'デモ', features: '機能', trust: '通信への非干渉', install: '導入' },
        hero: {
            tagline: 'パケットを読むだけ、|ゲームには触れない|艦これ用パネル',
            store: 'Chromeに追加',
            demo: 'デモを試す',
            note: '無料・オープンソース。データはブラウザの外に出ません。',
            changelog: '更新履歴',
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
        highlights: {
            title: 'パネルで見られること',
            lead: 'デモパネルの実際の画面です。番号は横の説明に対応しています。',
            shots: {
                port: {
                    title: '母港：出撃前の確認',
                    text: '資材・残り時間・艦隊の状態をまとめて確認できます。',
                    alt: '母港でのパネル：資材、遠征の残り時間、第1艦隊各艦の状態。',
                    notes: [
                        '8種類の資材を1列で表示。',
                        '遠征・入渠・建造の残り時間と通知。',
                        '艦隊・連合艦隊・基地航空隊の切り替え。',
                        '制空値・索敵（判定式33）・速力・合計Lv・TP。',
                        '各艦のHP・疲労・燃料弾薬の残量・装備。',
                    ],
                },
                sortie: {
                    title: '出撃：戦闘の結果をすぐに',
                    text: '戦闘パケットを受け取った時点で計算します。演出を待つ必要はありません。',
                    alt: '出撃中のパネル：海域ゲージ、航路、戦闘評価の予測、各艦の戦闘後HP。',
                    notes: [
                        '海域・ゲージ残量・通過したマス。',
                        '制空状態と交戦形態。',
                        '勝敗評価の予測と両軍の陣形。',
                        '敵艦隊の編成と撃沈状況。',
                        '戦闘後HPの予測。中破・大破がひと目でわかります。',
                        '燃料と弾薬の残量。出撃中はマスごとに消費を見積もります。',
                    ],
                },
            },
        },
        more: {
            title: '情報総括：あとで調べる',
            lead: 'パネルとは別に、記録と検索のための専用ページがあります。',
            items: [
                { title: '出撃ログ', text: '出撃ごとに1枚のカード。ルート・編成・マスごとの詳細・支援と基地航空隊の波次を記録し、リプレイとして書き出し可能。' },
                { title: '資材ログ', text: '8種類の資材を1枚の折れ線グラフに。イベント海域ごとの消費区間も集計。' },
                { title: '任務ガイド', text: '任務の進捗と前提関係を追跡し、条件を現在の編成と照合。' },
                { title: '艦娘・装備一覧', text: 'フィルタ・ソートできる保有一覧と装備の参考表。' },
                { title: 'ローカルバックアップ', text: '任意のフォルダへ書き出し。拡張なしでリプレイを再生できるオフラインHTMLビューア付き。' },
            ],
        },
        trust: {
            title: '通信への非干渉',
            lead: 'ゲームとサーバーの通信はこれまでどおりです。クロノメーターはゲームが受け取った応答のコピーだけを読み、ログインtokenを削除したうえで、艦隊の状態と戦闘予測を手元の端末で計算します。',
            alt: 'ゲームとサーバーの通信はそのまま。クロノメーターは応答のコピーを読み取り、tokenを削除し、すべてをブラウザのローカルデータベースに保存します。',
            items: [
                { title: '受動的な観測のみ', text: 'リクエストの再送・改変・代理送信も、自動操作も行いません。' },
                { title: '認証情報は外に出ない', text: 'ログインtokenは保存や受け渡しの前に削除され、保存されることはありません。' },
                { title: 'アップロードなし', text: '記録はすべてブラウザのIndexedDBに保存されます。バックエンドサーバーはありません。' },
                { title: '最小限の権限', text: 'インストール時にゲームサイトへのアクセスは求めません。ウィンドウ適応を使うときだけ確認します。' },
            ],
            sourceTitle: '動作はソースコードで確認できます。主なファイルは次のとおりです。',
            sources: [
                { path: 'entrypoints/interceptor.content.ts', text: 'ゲームのaxiosのレスポンスインターセプターにだけ登録し、応答のコピーを読み取ります。' },
                { path: 'entrypoints/bridge.content.ts', text: '送信元を確認し、ログインtokenを削除してからバックグラウンドへ渡します。' },
                { path: 'tests/interceptor-capture.test.ts', text: 'fetchとXMLHttpRequestを置き換えないことをテストで確認しています。' },
            ],
        },
        install: {
            title: '導入方法',
            text: `Chromeウェブストアからインストールし、ゲームを開いて拡張機能のアイコンをクリックするとパネルが開きます。${EDGE}などのChromium系ブラウザでも使えます。`,
            notice: '本プロジェクトは公開テスト中です。他の補助ツールと併用して重要な情報を相互確認し、大切な記録はご自身でバックアップしてください。',
            store: 'Chromeウェブストアを開く',
            contact: 'お問い合わせ',
            privacyPolicy: 'プライバシーポリシー',
        },
        changelog: { title: '更新履歴', lead: 'Chromeウェブストアで公開した各バージョンの変更点です。', back: 'トップへ戻る' },
        footer: 'クロノメーターはファンによる非公式ツールであり、DMM.comおよび角川ゲームスとは一切関係なく、公認・後援も受けていません。「艦隊これくしょん -艦これ-」およびゲーム内素材の著作権は各権利者に帰属します。',
    },
};
