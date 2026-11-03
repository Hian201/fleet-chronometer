"""編成任務、裝備準備／機種轉換任務與海域攻略任務的達成條件（人工審核資料）。

── 依據與審核方式 ───────────────────────────────────────────────────
每筆以兩個現行來源逐筆核對後撰寫，2026-11-03（來源寫不清楚、由使用者確認的條件在該筆註明）：
  1. wikiwiki.jp/kancolle「任務/編成任務」「任務/工廠任務」各任務列的說明與「※」備註
  2. KC3Kai kc3-translations data/jp/quests.json 的 desc／memo（以 api_no 為鍵，代號與 wikiwiki 一致）
kcwiki-quest-data（2024-06 後未更新）只當比對草稿：`generate.py --report` 列出與它不同之處，
不直接採用。兩個現行來源都沒寫清楚的條件不收錄（見 EXCLUDED），不猜。

艦名、裝備名寫 start2（samples/start2-master.json）的日文原名，產生器換成 master id；
對不上一律報錯。艦名表示「此改造階段以後」（與任務條件表相同語意，例：「瑞鶴改」含改二）。
艦種用 api_mst_stype 的 id；裝備類別用 api_type[2]，「○○系」的分組沿用任務條件表的慣例。
"""

# 艦種
DE, DD, CL, CLT, CA, CAV, CVL, FBB, BB, BBV, CV, SS, SSV, AV, AS, CT, CVB = 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 16, 20, 21, 18
CARRIERS = (CVL, CV, CVB)
CL_CLASS = (CL, CLT, CT)
SUBS = (SS, SSV)
# 裝備類別（api_type[2]）
T_SMALL, T_MEDIUM, T_LARGE, T_SECONDARY, T_TORPEDO = 1, 2, 3, 4, 5
T_FIGHTER, T_DIVE, T_TORPEDO_BOMBER, T_CARRIER_RECON, T_SEAPLANE_RECON = 6, 7, 8, 9, 10
T_RADAR = (12, 13)
T_DEPTH_CHARGE, T_ENGINE, T_AA_GUN = 15, 17, 21


# ── 編成條件 ──
def flag(*names, lv=None):
    return {'k': 'flag', 'ships': list(names), **({'lv': lv} if lv else {})}


def second(*names, lv=None):
    return {'k': 'second', 'ships': list(names), **({'lv': lv} if lv else {})}


def ships(n, *names):
    """names 任一（各自改造階段以後）合計至少 n 艘。"""
    return {'k': 'ships', 'ships': list(names), 'n': n}


def each(*names):
    return [ships(1, name) for name in names]


def flagtype(*types):
    return {'k': 'flagType', 'types': list(types)}


def types(n, *ids):
    return {'k': 'types', 'types': list(ids), 'n': n}


def flagclass(*reps, lv=None):
    """艦級以代表艦名指定（取該艦的 api_ctype）。"""
    return {'k': 'flagClass', 'classes': list(reps), **({'lv': lv} if lv else {})}


def classes(n, *reps, lv=None, exclude=()):
    return {'k': 'classes', 'classes': list(reps), 'n': n, **({'lv': lv} if lv else {}), **({'exclude': list(exclude)} if exclude else {})}


def size(lo=None, hi=None):
    return {'k': 'size', **({'min': lo} if lo else {}), **({'max': hi} if hi else {})}


def ban(*ids):
    return {'k': 'ban', 'types': list(ids)}


def fast():
    return {'k': 'fast'}


def flat(*parts):
    out = []
    for part in parts:
        out.extend(part if isinstance(part, list) else [part])
    return out


ANY = 'any'  # 未指定艦隊：任一艦隊符合即可（KC3Kai 174／175 備註「第一艦隊でなくても可」）

COMPOSITION = {
    101: ('A1', ANY, [size(2)]),
    102: ('A2', ANY, [types(4, DD)]),
    # 使用者確認（2026-11-03）：隨伴的駆逐艦 2 艘以上即可達成（現行兩個來源只寫「数隻」）。
    103: ('A3', ANY, [flagtype(CL), types(2, DD)]),
    104: ('A4', ANY, [size(6)]),
    105: ('A5', ANY, [types(2, CL)]),
    106: ('A7', ANY, [types(2, CA)]),
    107: ('A12', ANY, [flagtype(*CARRIERS), types(3, DD)]),
    108: ('A8', ANY, each('天龍', '龍田')),
    109: ('A14', ANY, each('川内', '神通', '那珂')),
    110: ('A15', ANY, each('妙高', '那智', '足柄', '羽黒')),
    111: ('A17', ANY, each('扶桑', '山城')),
    112: ('A18', ANY, each('伊勢', '日向')),
    113: ('A13', ANY, [types(1, FBB, BB), types(2, CA), ban(BBV)]),
    114: ('A19', ANY, flat(each('赤城', '加賀', '飛龍', '蒼龍'), size(hi=4))),
    115: ('A6', 2, [size(1)]),
    116: ('A9', ANY, [types(1, AV)]),
    117: ('A11', 2, [types(1, *CARRIERS), types(2, DD)]),
    118: ('A16', ANY, each('金剛', '比叡', '榛名', '霧島')),
    119: ('A20', ANY, flat(each('鳥海', '青葉', '加古', '古鷹', '天龍'), size(6), fast())),
    120: ('A10', ANY, flat(each('暁', '響', '雷', '電'), size(hi=4))),
    121: ('A21', ANY, each('愛宕', '高雄', '鳥海', '摩耶')),
    122: ('A22', ANY, each('扶桑', '山城', '最上', '時雨')),
    123: ('A23', ANY, flat(each('翔鶴', '瑞鶴'), types(2, DD))),
    124: ('A24', ANY, each('鳥海', '青葉', '衣笠', '加古', '古鷹', '天龍')),
    125: ('A25', ANY, [types(2, *SUBS)]),
    126: ('A26', ANY, [types(2, BBV), types(2, CAV)]),
    127: ('A27', ANY, [types(3, *SUBS)]),
    128: ('A28', ANY, each('古鷹', '加古', '青葉', '衣笠')),
    129: ('A29', ANY, each('那智', '足柄', '多摩', '木曾')),
    130: ('A30', ANY, each('阿武隈', '曙', '潮', '霞', '不知火')),
    131: ('A31', ANY, flat(each('朝潮', '満潮', '大潮', '荒潮'), size(hi=4))),
    132: ('A32', ANY, flat(each('霞', '霰', '陽炎', '不知火'), size(hi=4))),
    133: ('A33', ANY, flat(each('睦月', '如月', '弥生', '望月'), size(hi=4))),
    134: ('WA01', 1, [flag(lv=(90, 99))]),
    135: ('WA02', 1, [flag(lv=(100, None)), size(6)]),
    136: ('A34', ANY, flat(each('睦月', '卯月', '弥生', '望月'), size(hi=4))),
    137: ('A35', ANY, each('妙高', '那智', '羽黒')),
    138: ('A36', ANY, [flag('飛龍改二'), ships(1, '蒼龍'), types(2, DD)]),
    139: ('A37', ANY, [flagtype(AS), types(4, *SUBS)]),
    140: ('A38', 1, [flag('妙高改二')]),
    141: ('A39', ANY, [flag('蒼龍改二'), ships(1, '飛龍改二'), types(2, DD)]),
    142: ('A40', ANY, each('金剛改二', '比叡改二', '榛名改二', '霧島改二')),
    143: ('A41', 1, [flag('雲龍')]),
    144: ('A42', ANY, each('長門', '陸奥', '扶桑', '山城')),
    # KC3Kai 備註：大和型・長門型・伊勢型・扶桑型を4隻以上投入すると達成不可。
    145: ('A43', ANY, [classes(3, '大和', '長門', '伊勢', '扶桑'), {'k': 'classesMax', 'classes': ['大和', '長門', '伊勢', '扶桑'], 'n': 3}, types(1, CL)]),
    146: ('A45', 1, [flag('明石')]),
    147: ('A44', ANY, each('扶桑', '山城', '最上', '時雨', '満潮')),
    # 「駆逐艦4隻」含旗艦霞（艦隊上限 6 艘：霞＋足柄＋軽巡＋駆逐 3）。
    148: ('A46', ANY, [flag('霞'), ships(1, '足柄'), types(1, CL), types(4, DD)]),
    # 2025-01-28 起改為五艘中任四艘（KC3Kai 備註）。
    149: ('A47', ANY, [ships(4, '吹雪', '白雪', '初雪', '深雪', '叢雲'), size(hi=4)]),
    150: ('A48', ANY, flat(each('初春', '子日', '若葉', '初霜'), size(hi=4))),
    151: ('A49', ANY, flat(each('皐月', '文月', '長月'), types(4, DD), size(hi=4))),
    152: ('A50', 1, [flag('鳥海改二'), ships(5, '古鷹', '加古', '青葉', '衣笠', '夕張', '天龍')]),
    153: ('A51', ANY, flat(each('天龍', '龍田'), size(4))),
    154: ('A52', ANY, each('比叡', '霧島', '長良', '暁', '雷', '電')),
    155: ('A53', ANY, flat(flag('暁改二'), each('響', '雷', '電'), size(hi=4))),
    156: ('A54', ANY, flat(flag('阿武隈'), each('響', '初霜', '若葉', '五月雨', '島風'))),
    157: ('A55', ANY, flat(flag('阿武隈改二'), each('響', '夕雲', '長波', '秋雲', '島風'))),
    158: ('A92', 1, [flag('長門改二'), second('陸奥改二')]),
    161: ('A56', ANY, each('翔鶴', '瑞鶴', '朧', '秋雲')),
    162: ('A57', ANY, each('那智改二', '足柄改二', '多摩', '木曾')),
    163: ('A58', ANY, flat(flag('足柄'), each('球磨', '長良'))),
    164: ('A59', ANY, flat(flag('瑞鶴改'), each('瑞鳳', '千歳航', '千代田航'))),
    165: ('A60', ANY, each('伊勢改', '日向改')),
    166: ('A61', ANY, flat(flag('瑞鶴改'), each('瑞鳳改', '千歳航', '千代田航', '伊勢改', '日向改'))),
    167: ('A62', ANY, flat(each('翔鶴改二', '瑞鶴改二'), types(2, DD))),
    168: ('A63', ANY, flat(flag('名取'), each('五十鈴', '鬼怒'))),
    169: ('A64', ANY, [types(2, *CARRIERS), types(2, CAV, BBV), types(2, DD)]),
    170: ('A65', ANY, flat(flag('霞'), each('足柄', '大淀', '朝霜', '清霜'))),
    171: ('A66', ANY, flat(flag('五十鈴改二'), each('皐月改二', '卯月改'))),
    172: ('A67', ANY, flat(flag('白露改'), each('時雨', '春雨', '五月雨'), size(hi=4))),
    173: ('A68', ANY, flat(flag('川内改二'), each('江風改二', '時雨改二'), types(4, DD), size(hi=5))),
    174: ('A69', ANY, [flagtype(*CL_CLASS), types(4, DD)]),
    175: ('A70', ANY, flat(flag('朝潮改二'), each('大潮', '満潮', '荒潮'))),
    176: ('A71', ANY, each('朝潮改二丁', '大潮改二')),
    177: ('A72', ANY, each('磯波', '浦波', '綾波', '敷波')),
    178: ('A73', ANY, each('鬼怒', '青葉', '北上', '大井')),
    179: ('A74', ANY, [flag('鬼怒改二'), ships(5, '北上改二', '大井改二', '球磨改', '青葉改', '浦波改', '敷波改')]),
    180: ('A75', 1, each('長門改二', '陸奥改')),
    181: ('A76', 1, flat(flag('熊野改二'), second('鈴谷改二'), each('最上改', '三隈改'))),
    182: ('A77', 1, flat(flag('伊勢改', '日向改', lv=(50, None)), second('伊勢改', '日向改', lv=(50, None)),
                        each('伊勢改', '日向改'), types(1, CL), types(2, DD), size(6))),
    183: ('A78', 1, flat(flag('由良改二'), each('村雨', '夕立', '春雨', '五月雨'), types(5, DD))),
    184: ('A79', ANY, each('文月改二', '皐月改二', '長月改', '水無月改')),
    185: ('A80', 1, [flag('Saratoga Mk.II'), types(1, CL), types(2, DD)]),
    186: ('A81', ANY, each('朝潮改二', '大潮改二', '荒潮改二', '満潮改二')),
    187: ('A82', 3, each('最上', '時雨', '満潮', '朝雲', '山雲')),
    188: ('A83', ANY, [flag('長波改二'), ships(1, '高波改', '沖波改', '朝霜改'), size(2, 2)]),
    189: ('A84', ANY, [flag('村雨改二'), ships(3, '由良改二', '夕立改二', '春雨改', '五月雨改', '秋月改'), size(6)]),
    190: ('A85', ANY, flat(each('若葉改', '初春改二', '初霜改二'), size(hi=4))),
    191: ('A86', ANY, each('浦風改', '谷風改', '磯風乙改', '浜風乙改')),
    192: ('A87', ANY, each('霰改二', '霞改二', '陽炎改', '不知火改')),
    193: ('A88', ANY, flat(each('陽炎改二', '不知火改二', '黒潮改二'),
                         classes(3, '陽炎', '夕雲', lv=(70, None), exclude=('陽炎改二', '不知火改二', '黒潮改二')))),
    194: ('A89', ANY, flat(each('天龍改二', '龍田改二'), size(hi=2))),
    195: ('A90', ANY, each('磯風乙改', '浜風乙改', '浦風丁改', '谷風丁改')),
    196: ('A91', ANY, flat(each('夕雲改二', '巻雲改二'), size(hi=2))),
    197: ('A93', ANY, flat(each('夕雲改二', '巻雲改二', '風雲改二', '秋雲改二'), size(hi=4))),
    198: ('A94', ANY, flat(each('朧改', '漣改', '曙改', '潮改'), size(hi=4))),
}


# ── 裝備準備／機種轉換 ──
def slot(index, gear, star=None, alv=False, keep=False):
    """秘書艦（第一艦隊旗艦）的裝備：index 為 1 起算的格位，None 表示任一格。
    keep：達成後裝備留在艦上（不轉換、不消耗），不要求解除鎖定。"""
    return {'slot': index, 'gear': gear, **({'star': star} if star else {}), **({'alv': True} if alv else {}), **({'keep': True} if keep else {})}


def hold(gear, n, star=None):
    """未裝備（不在艦上、不在基地航空隊）且未鎖定的持有數。"""
    return {'gear': gear, 'n': n, **({'star': star} if star else {})}


def scrap(n, *gears):
    return {'n': n, 'gears': list(gears)}


def scrap_type(n, *ids):
    return {'n': n, 'types': [i for part in ids for i in (part if isinstance(part, tuple) else (part,))]}


def scrap_times(n):
    return {'n': n, 'times': True}


def scrap_items(n):
    return {'n': n, 'items': True}


def res(fuel=0, ammo=0, steel=0, baux=0):
    return [fuel, ammo, steel, baux]


STAR_MAX = 10
# 轉換或消耗的裝備須先解除鎖定，否則任務達成但無法按下領取（KC3Kai 614〜616 備註、wikiwiki「装備ロック解除済」）；
# 準備用的裝備同樣要未鎖定（KC3Kai GearManager.countFree 的 isUnlock、各任務備註「消費装備のロックを予め解除」）。
# gate：「指定した旗艦・装備で廃棄しないと進まない」（wikiwiki「…を搭載して指定装備を廃棄」、KC3Kai 備註）。
# scrap 寫在「任務條件表已收錄」的任務上時只用來比對，計數仍以條件表為準。
EQUIPMENT = {
    610: dict(code='F10', scrap=[scrap_times(4)]),
    611: dict(code='WF01', scrap=[scrap_times(2)]),
    612: dict(code='F11', scrap=[scrap_times(3)]),
    614: dict(code='F13', flagtype=CARRIERS, slots=[slot(None, '九七式艦攻(友永隊)')], scrap=[scrap(2, '天山')], gate=True),
    615: dict(code='F14', flagtype=CARRIERS, slots=[slot(None, '九九式艦爆(江草隊)')], scrap=[scrap(2, '彗星')], gate=True),
    616: dict(code='F15', flagtype=CARRIERS, slots=[slot(None, '零戦52型丙(六〇一空)')], scrap=[scrap(2, '試製烈風 後期型')], gate=True),
    617: dict(code='F16', scrap=[scrap_times(10)]),
    620: dict(code='F88', flag=['赤城改二'], slots=[slot(1, '流星改(一航戦)', alv=True)],
             scrap=[scrap(4, '流星改'), scrap(1, '彩雲'), scrap(2, '九七式艦攻')], res=res(ammo=2800, baux=9000),
             items={'熟練搭乗員': 2}, gate=True),
    621: dict(code='F89', flagtype=CL_CLASS, slots=[slot(1, '7.7mm機銃')],
              scrap=[scrap(2, '25mm単装機銃'), scrap(2, 'ドラム缶(輸送用)'), scrap(1, '12cm30連装噴進砲')],
              res=res(ammo=1700), items={'開発資材': 30, '高速建造材': 10}, gate=True),
    622: dict(code='F20', flag=['翔鶴'], slots=[slot(None, '九七式艦攻(村田隊)')], scrap=[scrap(2, '天山')], gate=True),
    623: dict(code='F19', flag=['翔鶴', '赤城'], scrap=[scrap(3, '九七式艦攻')], gate=True),
    624: dict(code='F21', scrap=[scrap_items(7)]),
    625: dict(code='F23', scrap=[scrap_items(9)]),
    626: dict(code='Fm1', flag=['鳳翔'], slots=[slot(None, '零式艦戦21型', alv=True)],
             scrap=[scrap(2, '零式艦戦21型'), scrap(1, '九六式艦戦')], items={'熟練搭乗員': 1}, gate=True),
    627: dict(code='F24', flagtype=CARRIERS, slots=[slot(None, '零式艦戦21型(熟練)')], scrap=[scrap(2, '零式艦戦52型')], gate=True),
    628: dict(code='Fm2', flagtype=CARRIERS, slots=[slot(None, '零式艦戦21型(熟練)', alv=True)], scrap=[scrap(2, '零式艦戦52型')], gate=True),
    629: dict(code='F26', flag=['瑞鶴'], slots=[slot(None, '零式艦戦52型(熟練)', alv=True)], scrap=[scrap(1, '零戦52型丙(六〇一空)')], gate=True),
    630: dict(code='F28', flag=['瑞鶴'], slots=[slot(None, '零式艦戦21型(熟練)', alv=True)], scrap=[scrap(2, '零式艦戦21型')], gate=True),
    631: dict(code='F27', flag=['瑞鶴'], slots=[slot(None, '零戦52型丙(付岩井小隊)', alv=True)], scrap=[scrap(2, '零式艦戦62型(爆戦)')], gate=True),
    632: dict(code='F29', flag=['瑞鶴'], slots=[slot(None, '零戦21型(付岩本小隊)', alv=True)], scrap=[scrap(2, '零式艦戦52型')], gate=True),
    633: dict(code='F30', flag=['瑞鶴'], slots=[slot(None, '零戦52型甲(付岩本小隊)', alv=True)], scrap=[scrap(2, '彩雲')], gate=True),
    634: dict(code='F31', scrap=[scrap_items(9)]),
    635: dict(code='F32', scrap=[scrap_items(5)]),
    636: dict(code='F33', scrap=[scrap(2, '7.7mm機銃'), scrap(2, '12.7mm単装機銃')]),
    637: dict(code='Fq1', flag=['鳳翔'], slots=[slot(None, '九六式艦戦', star=STAR_MAX, alv=True)], items={'勲章': 2}),
    639: dict(code='F36', flag=['島風'], slots=[slot(None, '61cm五連装(酸素)魚雷', star=STAR_MAX), slot(None, '61cm三連装(酸素)魚雷', star=STAR_MAX)],
             items={'勲章': 2}),
    641: dict(code='F37', scrap=[scrap(2, 'ドラム缶(輸送用)')], hold=[hold('7.7mm機銃', 2), hold('九六式艦戦', 2)]),
    642: dict(code='F38', hold=[hold('7.7mm機銃', 2), hold('九九式艦爆', 2)]),
    643: dict(code='Fq2', scrap=[scrap(2, '零式艦戦21型')], hold=[hold('九六式陸攻', 1), hold('九七式艦攻', 2)]),
    644: dict(code='F40', hold=[hold('一式陸攻', 1), hold('天山', 2)]),
    645: dict(code='Fm3', scrap=[scrap(1, '三式弾')], res=res(fuel=750, ammo=750), hold=[hold('ドラム缶(輸送用)', 2), hold('九一式徹甲弾', 1)]),
    646: dict(code='F42', scrap=[scrap(1, '25mm単装機銃')], items={'家具コイン': 5000}, hold=[hold('25mm連装機銃', 2), hold('25mm三連装機銃', 2)]),
    647: dict(code='F43', scrap=[scrap(2, 'ドラム缶(輸送用)')], res=res(fuel=1200, baux=3000), items={'設営隊': 1}),
    648: dict(code='F44', scrap=[scrap(2, '12.7cm連装高角砲')], items={'家具コイン': 5000}, hold=[hold('14cm単装砲', 2), hold('15.2cm単装砲', 2)]),
    649: dict(code='F45', scrap=[scrap(2, '零式水上偵察機')], hold=[hold('一式陸攻', 1), hold('彩雲', 2)]),
    650: dict(code='F46', scrap=[scrap(3, '紫電改二')], items={'新型航空機設計図': 2, 'ネ式エンジン': 1}),
    651: dict(code='F47', scrap=[scrap(3, '零式艦戦52型')], res=res(steel=8000), hold=[hold('流星', 2), hold('試製烈風 後期型', 2)]),
    652: dict(code='F48', scrap=[scrap(2, '12.7cm連装砲')], items={'家具コイン': 5000}, hold=[hold('7.7mm機銃', 2), hold('九六式艦戦', 2)]),
    653: dict(code='Fq9', scrap=[scrap(6, '14cm単装砲')], items={'家具コイン': 6000}, hold=[hold('35.6cm連装砲', 3), hold('九六式艦戦', 3)]),
    654: dict(code='Fy2', flag=['Ark Royal'], slots=[slot(1, 'Swordfish', star=STAR_MAX)], scrap=[scrap(1, 'Swordfish'), scrap(2, 'Fulmar')],
             res=res(ammo=1500, baux=1500), items={'熟練搭乗員': 1}, gate=True),
    655: dict(code='Fy3', scrap=[scrap_type(5, T_SMALL), scrap_type(5, T_MEDIUM), scrap_type(5, T_LARGE), scrap_type(5, T_SEAPLANE_RECON),
                                 scrap_type(5, T_TORPEDO_BOMBER)], res=res(fuel=1500, steel=1500, baux=1500)),
    # 一番スロットの「晴嵐」は start2 の「試製晴嵐」（wikiwiki 備註：一番スロットに搭載した「試製晴嵐」も消滅）。
    656: dict(code='F49', flag=['伊401', '伊14', '伊13'], slots=[slot(1, '試製晴嵐'), slot(2, '瑞雲(六三一空)')]),
    657: dict(code='Fy1', scrap=[scrap_type(6, T_SMALL), scrap_type(5, T_MEDIUM), scrap_type(4, T_TORPEDO)], res=res(steel=4000)),
    658: dict(code='F50', scrap=[scrap(4, '61cm三連装魚雷')], items={'開発資材': 120}, hold=[hold('61cm四連装(酸素)魚雷', 3), hold('九三式水中聴音機', 3)]),
    659: dict(code='F51', slots=[slot(1, '二式水戦改', star=STAR_MAX, alv=True)], scrap=[scrap(2, '零式艦戦21型'), scrap(2, '瑞雲')],
             items={'熟練搭乗員': 1}, gate=True),
    660: dict(code='F52', slots=[slot(1, '二式水戦改', star=STAR_MAX, alv=True)], scrap=[scrap(2, '零式艦戦21型'), scrap(2, '瑞雲')],
             items={'熟練搭乗員': 1}, gate=True),
    661: dict(code='F53', scrap=[scrap_type(10, T_SECONDARY)], res=res(steel=6000)),
    662: dict(code='F54', scrap=[scrap_type(10, T_MEDIUM)], res=res(steel=12000)),
    663: dict(code='Fq3', scrap=[scrap_type(10, T_LARGE)], res=res(steel=18000)),
    664: dict(code='F56', scrap=[scrap_type(10, T_RADAR)], res=res(ammo=8000, steel=8000)),
    665: dict(code='F57', scrap=[scrap_type(16, T_SMALL)], res=res(fuel=12000)),
    666: dict(code='F58', flag=['日向改'], slots=[slot(4, '瑞雲(六三四空)', star=STAR_MAX)], scrap=[scrap(2, 'ドラム缶(輸送用)')],
             hold=[hold('九九式艦爆', 2), hold('瑞雲', 2)], items={'熟練搭乗員': 1}, gate=True),
    667: dict(code='F59', scrap=[scrap_type(10, T_AA_GUN)], res=res(steel=15000)),
    668: dict(code='F60', hold=[hold('戦闘糧食', 2)], res=res(fuel=800, baux=150)),
    669: dict(code='F61', slots=[slot(1, 'F6F-3', star=STAR_MAX, alv=True)], scrap=[scrap(2, '13号対空電探'), scrap(2, '22号対水上電探')],
             res=res(baux=5000), items={'開発資材': 30, '改修資材': 6, '新型航空兵装資材': 1}, gate=True),
    670: dict(code='F63', slots=[slot(1, 'F6F-5', star=STAR_MAX, alv=True)], scrap=[scrap(2, '13号対空電探'), scrap(2, '22号対水上電探')],
             res=res(baux=6000), items={'開発資材': 40, '改修資材': 8, '新型航空兵装資材': 1}, gate=True),
    671: dict(code='F62', slots=[slot(1, 'TBF')], scrap=[scrap(2, '13号対空電探'), scrap(2, '22号対水上電探')],
             res=res(ammo=5000, baux=8000), items={'開発資材': 40, '改修資材': 10, '新型航空兵装資材': 1, '熟練搭乗員': 1}, gate=True),
    # wikiwiki：旗艦一番スロットが条件を満たさなくても受注中の電探廃棄はカウントされる（gate なし）。
    672: dict(code='F64', slots=[slot(1, '艦隊司令部施設')], scrap=[scrap_type(3, T_RADAR)], res=res(steel=2000),
              items={'開発資材': 10, '戦闘詳報': 2}),
    674: dict(code='Fd8', scrap=[scrap_type(3, T_AA_GUN)], res=res(steel=300)),
    675: dict(code='Fq4', scrap=[scrap_type(6, T_FIGHTER), scrap_type(4, T_AA_GUN)], res=res(baux=800)),
    676: dict(code='Fw3', scrap=[scrap_type(3, T_MEDIUM), scrap_type(3, T_SECONDARY), scrap_type(1, 30)], res=res(steel=2400)),
    677: dict(code='Fw4', scrap=[scrap_type(4, T_LARGE), scrap_type(2, T_SEAPLANE_RECON), scrap_type(3, T_TORPEDO)], res=res(steel=3600)),
    678: dict(code='Fq5', slots=[slot(1, '零式艦戦52型', keep=True), slot(2, '零式艦戦52型', keep=True)], scrap=[scrap(3, '九六式艦戦'), scrap(5, '零式艦戦21型')],
             res=res(baux=4000)),
    679: dict(code='F71', scrap=[scrap_type(6, T_MEDIUM), scrap_type(3, T_SECONDARY)], res=res(baux=900)),
    680: dict(code='Fq6', scrap=[scrap_type(4, T_AA_GUN), scrap_type(4, T_RADAR)], res=res(baux=1500)),
    681: dict(code='Fy4', scrap=[scrap_type(4, T_DIVE), scrap_type(4, T_TORPEDO_BOMBER)], res=res(baux=1600), items={'開発資材': 20}),
    682: dict(code='F73', scrap=[scrap_type(4, T_MEDIUM), scrap_type(4, T_LARGE)], res=res(fuel=500)),
    683: dict(code='F74', flag=['伊勢改二'], slots=[slot(1, '試製41cm三連装砲', star=STAR_MAX)], scrap=[scrap(3, '41cm連装砲'), scrap(2, '22号対水上電探')],
             res=res(steel=4500), items={'開発資材': 40, '高速建造材': 50, '新型砲熕兵装資材': 2}, gate=True),
    684: dict(code='F75', flag=['伊勢改二'], slots=[slot(3, '彗星二二型(六三四空)')], scrap=[scrap(3, '九九式艦爆'), scrap(3, '彗星')],
             res=res(baux=3000), items={'熟練搭乗員': 1, '開発資材': 30, '新型航空兵装資材': 1}, gate=True),
    685: dict(code='F76', flagclass=['吹雪', '綾波', '暁'], slots=[slot(1, '12.7cm連装砲A型改二', star=STAR_MAX)],
             scrap=[scrap(4, '10cm連装高角砲'), scrap(1, '94式高射装置')], res=res(steel=900), items={'開発資材': 30, '新型砲熕兵装資材': 1}, gate=True),
    686: dict(code='Fq7', flagclass=['吹雪', '綾波', '暁'], slots=[slot(1, '12.7cm連装砲A型改二', star=STAR_MAX)],
             scrap=[scrap(4, '10cm連装高角砲'), scrap(1, '94式高射装置')], res=res(steel=900), items={'開発資材': 30, '新型砲熕兵装資材': 1}, gate=True),
    688: dict(code='Fq8', scrap=[scrap_type(3, T_FIGHTER), scrap_type(3, T_DIVE), scrap_type(3, T_TORPEDO_BOMBER), scrap_type(3, T_SEAPLANE_RECON)],
             res=res(baux=1800), items={'熟練搭乗員': 1}),
    689: dict(code='F80', scrap=[scrap_type(4, T_FIGHTER), scrap_type(4, T_SEAPLANE_RECON), scrap_type(2, T_CARRIER_RECON)],
             res=res(baux=3000), items={'熟練搭乗員': 1, '新型航空兵装資材': 1}),
    690: dict(code='F81', scrap=[scrap_type(4, T_FIGHTER), scrap_type(4, T_DIVE), scrap_type(4, T_TORPEDO_BOMBER)],
             res=res(baux=4800), items={'熟練搭乗員': 1, '新型航空兵装資材': 2}),
    691: dict(code='F82', scrap=[scrap_type(4, T_MEDIUM), scrap_type(4, T_SECONDARY), scrap_type(4, T_AA_GUN)], res=res(baux=1600)),
    692: dict(code='F83', scrap=[scrap_type(5, T_SMALL), scrap_type(5, T_LARGE), scrap_type(5, T_SEAPLANE_RECON)], res=res(steel=3000)),
    693: dict(code='F84', scrap=[scrap_type(4, T_SEAPLANE_RECON), scrap_type(3, T_FIGHTER), scrap_type(2, T_TORPEDO_BOMBER)],
             res=res(baux=3000), items={'開発資材': 20}),
    694: dict(code='F85', scrap=[scrap(4, '瑞雲'), scrap(4, '彗星'), scrap(2, '流星')], res=res(steel=8500, baux=4000), items={'開発資材': 60}),
    695: dict(code='F86', flag=['伊勢改二', '日向改二'], slots=[slot(1, '彗星一二型甲')], scrap=[scrap(4, '彗星'), scrap(3, '九九式艦爆'), scrap(2, '瑞雲')],
             res=res(ammo=2500, baux=5000), items={'新型航空兵装資材': 1}, gate=True),
    696: dict(code='F87', flag=['伊勢改二', '日向改二'], slots=[slot(1, '瑞雲改二(六三四空)', star=STAR_MAX)],
             scrap=[scrap(6, '瑞雲'), scrap(3, '彗星'), scrap(1, '試製烈風 後期型')], res=res(ammo=2000, baux=8000),
             items={'新型航空兵装資材': 1, '熟練搭乗員': 2}, gate=True),
    698: dict(code='F91', flag=['加賀改二護'], slots=[slot(1, 'TBM-3D')], scrap=[scrap(2, 'TBF'), scrap(1, '流星'), scrap(1, '流星改')],
             res=res(ammo=1840, baux=6200), items={'新型航空兵装資材': 2, '熟練搭乗員': 1}, gate=True),
    1101: dict(code='F96', scrap=[scrap(8, '12.7cm連装砲')], items={'家具コイン': 4000}, hold=[hold('14cm単装砲', 4), hold('20.3cm連装砲', 4)]),
    1102: dict(code='F97', scrap=[scrap(7, '12cm単装砲')], res=res(fuel=2400), hold=[hold('20.3cm連装砲', 5), hold('35.6cm連装砲', 5)]),
    1103: dict(code='Fy5', scrap=[scrap(3, '61cm三連装(酸素)魚雷')], items={'開発資材': 60}, hold=[hold('九三式水中聴音機', 2), hold('13号対空電探改', 2)]),
    1104: dict(code='Fy6', scrap=[scrap(3, '13号対空電探改')], items={'開発資材': 100}, hold=[hold('九三式水中聴音機', 2), hold('22号対水上電探', 2)]),
    1106: dict(code='F101', flag=['由良改二'], slots=[slot(1, '零式水上偵察機11型乙', star=STAR_MAX)], scrap=[scrap(3, '零式水上偵察機'), scrap(3, '瑞雲')],
              res=res(fuel=1300, baux=1700), items={'新型航空兵装資材': 1, '戦闘詳報': 1, '熟練搭乗員': 3}, gate=True),
    1108: dict(code='F103', flag=['山風改二', '時雨改二'], slots=[slot(1, '三式水中探信儀', star=STAR_MAX)],
               scrap=[scrap(2, '九三式水中聴音機'), scrap(2, '三式水中探信儀')], res=res(baux=1300), items={'新型兵装資材': 2, '開発資材': 30}, gate=True),
    1109: dict(code='F104', flag=['神州丸'], slots=[slot(1, '大発動艇(八九式中戦車&陸戦隊)', star=STAR_MAX)],
               scrap=[scrap(2, '7.7mm機銃'), scrap(2, '大発動艇')], res=res(steel=800), items={'高速建造材': 8, '開発資材': 10}, gate=True),
    1111: dict(code='F105', hold=[hold('一式陸攻 二二型甲', 1, star=STAR_MAX), hold('一式陸攻', 2)], items={'熟練搭乗員': 3}),
    1112: dict(code='F106', scrap=[scrap_type(4, T_SMALL), scrap_type(4, T_MEDIUM), scrap_type(4, T_LARGE)], hold=[hold('ドラム缶(輸送用)', 1)],
               res=res(steel=1800), items={'開発資材': 10}),
    1113: dict(code='F107', hold=[hold('キ102乙', 1), hold('二式複戦 屠龍 丙型', 1)], items={'熟練搭乗員': 2, '新型航空兵装資材': 4}),
    1123: dict(code='Fy10', flag=['利根改二', '由良改二'], slots=[slot(1, '零式水上偵察機', star=STAR_MAX)], scrap=[scrap(2, '九七式艦攻(九三一空)')],
               res=res(baux=950), items={'新型航空兵装資材': 2, '開発資材': 35, '熟練搭乗員': 2}, gate=True),
    1127: dict(code='F115', flag=['深雪改二'], slots=[slot(1, '発煙装置(煙幕)')], hold=[hold('発煙装置(煙幕)', 2)],
               res=res(fuel=480, baux=350), items={'開発資材': 12, '新型兵装資材': 2}),
    1128: dict(code='F116', flag=['榛名改二乙'], slots=[slot(1, '35.6cm連装砲改三(ダズル迷彩仕様)', star=3)], hold=[hold('35.6cm連装砲', 5)],
               res=res(ammo=960, baux=800), items={'開発資材': 48, '新型砲熕兵装資材': 2}),
    1129: dict(code='F117', flagtype=SUBS, slots=[slot(1, '後期型艦首魚雷(6門)', star=STAR_MAX)],
               hold=[hold('61cm三連装(酸素)魚雷', 4), hold('熟練見張員', 3)], res=res(ammo=800), items={'開発資材': 36, '新型兵装資材': 2}),
    # 「バルジ」系：遊戲以裝備類別 27／28 判定（増設バルジ、艦本新設計 増設バルジ、プリエーゼ式水中防御隔壁、
    # 北方迷彩(+北方装備) 皆屬之，使用者確認 2026-11-03）。依使用者決定，暫且只計可開發的
    # 「増設バルジ(中型艦)」「増設バルジ(大型艦)」：廢棄其他バルジ時遊戲會計入而本機不計，只會少算。
    1130: dict(code='F118', scrap=[scrap_type(3, T_AA_GUN), scrap_type(3, T_ENGINE), scrap(3, '増設バルジ(中型艦)', '増設バルジ(大型艦)')],
               hold=[hold('ドラム缶(輸送用)', 3)], res=res(steel=5500, baux=2700)),
    1131: dict(code='F119', scrap=[scrap_type(18, T_SMALL), scrap_type(12, T_MEDIUM), scrap_type(6, T_DEPTH_CHARGE)],
               hold=[hold('応急修理要員', 1)], res=res(ammo=2500, steel=3000)),
    1132: dict(code='F120', flag=['清霜改二'], slots=[slot(1, '12.7cm連装砲D型改二', star=8)], hold=[hold('12.7cm連装砲', 10)],
               res=res(ammo=350), items={'開発資材': 22, '新型砲熕兵装資材': 1, '改修資材': 8}),
    1133: dict(code='F121', flag=['清霜改二', '朝霜改二'], slots=[slot(1, '22号対水上電探改四(後期調整型)')], hold=[hold('13号対空電探改(後期型)', 1, star=4)],
               items={'開発資材': 40, '改修資材': 6}),
    1134: dict(code='F122', flag=['時雨改二', '満潮改二'], slots=[slot(1, '22号対水上電探改四', star=STAR_MAX)], hold=[hold('22号対水上電探', 4)],
               items={'開発資材': 22, '新型兵装資材': 2, '改修資材': 6}),
    1137: dict(code='F123', flagclass=['鵜来'], slots=[slot(1, '三式爆雷投射機')], hold=[hold('三式爆雷投射機', 1)],
               scrap=[scrap(4, '九三式水中聴音機'), scrap(4, '九四式爆雷投射機'), scrap(4, '九五式爆雷')], items={'開発資材': 32}, gate=True),
    1141: dict(code='F126', flag=['大和改二', '由良改二', '矢矧改二'], slots=[slot(1, '零式水上偵察機11型乙', star=STAR_MAX)],
               scrap=[scrap(15, '零式水上偵察機')], items={'新型航空兵装資材': 2, '開発資材': 60, '夜間熟練搭乗員': 1}, gate=True),
    1142: dict(code='F127', flag=['翔鶴改二'], slots=[slot(1, '天山一二型(村田隊)')], scrap=[scrap(4, '天山')],
               hold=[hold('天山一二型甲改(空六号電探改装備機)', 1)], items={'新型航空兵装資材': 2, '開発資材': 48, '夜間熟練搭乗員': 1}, gate=True),
    1143: dict(code='F128', flag=['霧島改二丙'], slots=[slot(1, '35.6cm連装砲改二', star=8)], scrap=[scrap(8, '35.6cm連装砲')],
               hold=[hold('35.6cm連装砲改', 1)], res=res(steel=7800), items={'新型砲熕兵装資材': 2, '新型兵装資材': 2}, gate=True),
    1151: dict(code='F131', scrap=[scrap_type(14, T_SEAPLANE_RECON), scrap_type(12, T_MEDIUM), scrap_type(10, T_DIVE)],
               hold=[hold('零式艦戦21型', 8), hold('零式艦戦32型', 4)], items={'開発資材': 36}),
    1155: dict(code='F135', flagclass=['秋月'], flaglv=70, slots=[slot(1, '10cm連装高角砲'), slot(2, '10cm連装高角砲'), slot(3, '94式高射装置')],
               scrap=[scrap(8, '12.7cm連装高角砲')], items={'新型砲熕兵装資材': 2}, gate=True),
    1158: dict(code='F136', flag=['早波'], escorts=[ships(3, '玉波', '涼波', '藤波', '浜波')],
               scrap=[scrap(5, '九三式水中聴音機'), scrap(5, '三式水中探信儀'), scrap(5, '九五式爆雷')],
               hold=[hold('三式爆雷投射機', 8)], items={'新型兵装資材': 1}, gate=True),
    1170: dict(code='F143', flag=['北上改二'], scrap=[scrap(12, '12.7cm連装高角砲'), scrap(8, '8cm高角砲'), scrap(4, '25mm三連装機銃')],
               res=res(ammo=750), items={'開発資材': 36, '改修資材': 8}, gate=True),
}

# 海域攻略（量表擊破）：攻略後才受注也算達成（wikiwiki B176 備註）。
MAP_CLEAR = {
    967: dict(code='B176', map=74),
}

# 現行來源無法確認、因此不收錄的任務與理由（generate.py 會確認它們不在上面的表裡）。
EXCLUDED: dict[int, str] = {}
