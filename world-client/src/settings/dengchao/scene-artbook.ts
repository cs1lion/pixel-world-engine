/** 灯潮界场景补绘的资产清单：每一项都对应设定集 PDF 的具体页与形制。
 *
 * 这份文件只放**数据**，怎么画在 `render/scene-artbook.ts`。分开的理由和灯街一样：
 * 页码与形制是设定集的事实，应该能被人一眼核对；渲染代码则是引擎口径。
 *
 * 页码用的是**扫描件 PDF 的物理页**（打开 PDF 时左下角那一个），不是书里印的
 * 页码。设定集正文从 PDF p14 起才进入场景章节，p14 之前是扉页。
 *
 * 不发明原作没有的形制：
 * - 主楼按 p15 全景、p16 剖面/入口、p39 正立面、p46 门桥；
 * - 炉底按 p48（锅炉房内景）与 p23（煤堆）；
 * - 渡口按 p41（石砌驳岸与下水踏步）与 p3（对岸夜景）；
 * - 街市按 p35（弧形山墙店面）、p37/p40（檐下红灯与木构店面）；
 * - 远景按 p3/p41（对岸屋脊线与钟塔）。
 */

import type { SettingScenery } from '../types.ts';

type GridPoint = SettingScenery['at'];

export type ArtbookGroup = 'main' | 'street' | 'ferry' | 'environment';

export interface ArtbookAsset {
  readonly id: string;
  readonly name: string;
  readonly group: ArtbookGroup;
  /** 扫描件 PDF 的物理页。 */
  readonly pdfPage: string;
  /** 用到的形制特征。写"几层屋顶、檐口怎么收、招牌什么形制"，不是"参考风格"。 */
  readonly features: readonly string[];
  /**
   * 需要进 `pack.scenery` 的装饰构件。主楼、桥、檐下灯这些是**既有构件上的补绘**，
   * 没有这一项；它们按 kind/id 找既有件，避免坐标写第二份。
   */
  readonly placement?: {
    readonly kind: SettingScenery['kind'];
    readonly at: GridPoint;
    readonly length?: number;
  };
}

export const SCENE_ARTBOOK_ASSETS: readonly ArtbookAsset[] = [
  {
    id: 'bathhouse_main',
    name: '主楼正立面',
    group: 'main',
    pdfPage: 'PDF p15、p16、p39、p46',
    features: [
      '三层屋面：下层大庑殿、中层腰檐、上层攒尖小顶；檐口逐层收进，四角起翘',
      '屋面一律铜绿，正脊与宝顶用 trim 金；脊端立小鸱尾，檐下压一道深影',
      '主体赭红木骨，三道米白灰泥腰线；每层一排格子窗，窗后是望楼栏杆',
      '中央入口向外凸出，做弧形山墙门楼；门楼上悬横匾，匾下挂三幅暖帘',
      '右侧独立砖砌烟囱，高出主楼一层檐；筒身每 24px 一道箍，顶口冒柱状烟',
      '左墙外挂一幅竖幌，幌面压深色团记（p16 入口那张大幌的形制）',
    ],
  },
  {
    id: 'bathhouse_bridge',
    name: '主楼门桥',
    group: 'main',
    pdfPage: 'PDF p16、p39、p46',
    features: [
      '朱红桥面，横铺板缝；桥台为浅色条石，桥下就是那道潮水口',
      '栏板为方眼格子：上下两道横枋，每 8px 一根立柱，柱间不加斜撑',
      '两端望柱压金色柱头；桥头一对方形纸灯，灯箱挂在木柱上',
    ],
  },
  {
    id: 'bathhouse_smoke',
    name: '主楼烟囱的烟',
    group: 'main',
    pdfPage: 'PDF p15、p39',
    features: ['烟囱顶口先起一段直柱，再散成两层；颜色是灰白，不是黑烟'],
    placement: { kind: 'steam', at: { x: 36, y: 11 } },
  },
  {
    id: 'boiler_furnace',
    name: '炉底炉膛',
    group: 'main',
    pdfPage: 'PDF p48、p23',
    features: [
      '砖砌炉膛，正面开拱形炉口，口内透橙火而不是整面发光',
      '铁皮烟道先横走一段，再折向上接砖烟囱；接口处有两道铁箍',
      '炉前煤堆反光，铁铲斜插在煤里；地面是夯土，不是石板',
    ],
    placement: { kind: 'boiler', at: { x: 33, y: 14 } },
  },
  {
    id: 'boiler_coal',
    name: '炉前煤堆',
    group: 'main',
    pdfPage: 'PDF p48、p23',
    features: ['煤堆分三层收顶，边缘留一线暖高光；旁边一只浅木桶，桶箍两道'],
    // 放在炉膛右前方的夯土上；早先写在 (27,17)，离炉口太远，进了主楼正视的
    // 左上角，读成一团悬在竖幌上的黑影。
    placement: { kind: 'coal_heap', at: { x: 34, y: 16 } },
  },
  {
    id: 'boiler_smoke',
    name: '炉底烟囱的烟',
    group: 'main',
    pdfPage: 'PDF p48',
    features: ['烟从砖烟囱口垂直起，比主楼的烟细一档，颜色更沉'],
    placement: { kind: 'steam', at: { x: 33, y: 12 } },
  },
  {
    id: 'ferry_quay',
    name: '渡口石砌突堤',
    group: 'ferry',
    pdfPage: 'PDF p41、p3',
    features: [
      '条石错缝砌出的突堤，堤面比水面高两级；堤头三级踏步下水',
      '堤边两根系船石柱，绳绕两道；柱头不做雕饰，只留一道浅檐',
      '堤面留一块较亮的候船石，石缝里长苔',
    ],
    // 横向口径：`length` 是**沿岸的横向格数**，不伸进湾里（伸进去会读成石柱）。
    placement: { kind: 'quay', at: { x: 5, y: 7 }, length: 5 },
  },
  {
    id: 'street_gable_west',
    name: '街市弧形山墙店面（西）',
    group: 'street',
    pdfPage: 'PDF p35、p40',
    features: [
      '灰泥立面 + 木骨，顶部弧形山墙分三级收分，像半个拱',
      '山墙中央一扇圆窗，窗下挂两枚竖招牌，招牌压深色字块',
      '檐下一排红纸灯，灯距 8px；底层是木格门，门边留水痕',
    ],
    placement: { kind: 'shopfront_gable', at: { x: 12, y: 23 }, length: 4 },
  },
  {
    id: 'street_gable_east',
    name: '街市弧形山墙店面（东）',
    group: 'street',
    pdfPage: 'PDF p35、p40',
    features: [
      '弧形山墙改为单级收分，圆窗偏左；右侧挂一块横招牌',
      '墙面有补过的深色木板与一条纵向雨痕；檐下三盏红灯',
    ],
    // 必须落在主楼占地（x28..34）以东：早先写在 (33,23)，与主楼东翼重叠，
    // 补绘层把那段墙读成了红砖噪声。
    placement: { kind: 'shopfront_gable', at: { x: 36, y: 23 }, length: 4 },
  },
  {
    id: 'street_steps',
    name: '街面石阶',
    group: 'street',
    pdfPage: 'PDF p35、p40',
    features: [
      '四级石阶，每级 4px 高；阶沿压一条亮边，阶心留深影',
      '两侧短挡墙压住街面，挡墙头与阶沿同高；缝里长苔',
    ],
    placement: { kind: 'steps', at: { x: 20, y: 31 }, length: 4 },
  },
  {
    id: 'street_drain',
    name: '街面石沟',
    group: 'street',
    pdfPage: 'PDF p35（石作层叠；沟槽是按街面分段补的延伸件）',
    features: [
      '石沟两侧各压一条条石，沟心深一档，沟底留一线水',
      '每 8 格一块铁格栅，格栅四边压石，栅条两道',
    ],
    placement: { kind: 'drain', at: { x: 12, y: 30 }, length: 40 },
  },
  {
    id: 'street_paving_south',
    name: '街面南段铺装',
    group: 'street',
    pdfPage: 'PDF p40',
    features: ['暗色湿石街面，石板错缝；缝里留苔，靠摊位一侧更暗'],
    placement: { kind: 'street_paving', at: { x: 12, y: 31 }, length: 40 },
  },
  {
    id: 'shopfront_weathering',
    name: '店铺墙面斑驳',
    group: 'street',
    pdfPage: 'PDF p40',
    features: [
      '檐下墙面有纵向水痕，灰泥脱落处露石，补板用深木色',
      '雨痕从檐口垂到窗上沿，不落到窗里；补板压住一半旧缝',
    ],
  },
  {
    id: 'shopfront_lanterns',
    name: '店铺檐下红灯',
    group: 'street',
    pdfPage: 'PDF p37、p40',
    features: ['檐下每 8px 一盏红纸灯，成排悬挂；灯顶压深木色小檐，灯心发暖'],
  },
  {
    id: 'shopfront_awning',
    name: '店铺布幔',
    group: 'street',
    pdfPage: 'PDF p37、p40',
    features: ['店檐下橙红布幔，边缘分条；幔脚被风掀成一角'],
  },
  {
    id: 'far_ridge',
    name: '对岸屋脊线与山影',
    group: 'environment',
    pdfPage: 'PDF p3、p41',
    features: [
      '水对岸是一条连续低矮的坡顶屋脊，山墙很少，几乎全是横脊',
      '屋脊后叠两层山影，后一层更浅；低处留一线雾，把屋脚吃掉',
      '沿屋脊点少量暖窗，间距很大，不连成灯带',
    ],
    placement: { kind: 'ridge', at: { x: 1, y: 13 }, length: 62 },
  },
  {
    id: 'far_clock_tower',
    name: '对岸钟塔',
    group: 'environment',
    pdfPage: 'PDF p3',
    features: [
      '方塔身，三层收分；二层四面一块钟盘，夜里钟盘发暖光',
      '塔顶攒尖小顶，塔下缘一圈红灯；塔身比两侧屋脊高出一倍',
    ],
    placement: { kind: 'far_tower', at: { x: 18, y: 15 } },
  },
  {
    id: 'bay_mist',
    name: '湾面低雾',
    group: 'environment',
    pdfPage: 'PDF p41、p3',
    features: ['贴水面的横向长条低雾，缓慢横移；不盖住屋脊，只吃屋脚与水面'],
  },
  {
    id: 'water_reflection',
    name: '水面灯影',
    group: 'environment',
    pdfPage: 'PDF p41、p3',
    features: ['灯光在水面拉成竖向光柱，分三档亮度；近岸短、离岸长，边缘散开'],
  },
  {
    id: 'shopfront_eave_rows',
    name: '街景分段（既有件补绘）',
    group: 'street',
    pdfPage: 'PDF p35、p40',
    features: ['沿街立面按店铺分段：每段独立檐口、布幔与灯排，段与段之间留一道暗缝'],
  },
];

/** 交给 `pack.scenery` 的那部分。 */
export function sceneArtbookScenery(): readonly SettingScenery[] {
  return SCENE_ARTBOOK_ASSETS.flatMap((asset) => {
    const place = asset.placement;
    if (place === undefined) return [];
    return [{
      kind: place.kind,
      at: place.at,
      ...(place.length === undefined ? {} : { length: place.length }),
    }];
  });
}
