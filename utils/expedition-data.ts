// 出典: poi-plugin-expedition (MIT License) https://github.com/poooi/plugin-expedition
// 遠征 #id ごとの出撃条件データ。ゲーム内APIには存在しないため、静的データとして保持。
// id 41–46/103–105/112–115/131–133/141–142 の出撃条件は ElectronicObserver（MIT）から、
// 収益数字（reward_fuel/bullet/steel/alum/items）は wikiwiki.jp/kancolle/遠征 の詳細一覧表
// から補完（2026-08-03、api_win_mat_level の 0/非0 パターンと全件突合済み）。詳細は
// CLAUDE.md「遠征資料完整性」節参照。
const data = [
  {
    "id": 1,
    "reward_fuel": 0,
    "reward_bullet": 30,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [],
    "flagship_lv": 1,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 2,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [],
    "big_success": null
  },
  {
    "id": 2,
    "reward_fuel": 0,
    "reward_bullet": 100,
    "reward_steel": 30,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      }
    ],
    "flagship_lv": 2,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [],
    "big_success": null
  },
  {
    "id": 3,
    "reward_fuel": 30,
    "reward_bullet": 30,
    "reward_steel": 40,
    "reward_alum": 0,
    "reward_items": [],
    "flagship_lv": 3,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 3,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [],
    "big_success": null
  },
  {
    "id": 4,
    "reward_fuel": 0,
    "reward_bullet": 60,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      },
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 3,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 3,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "big_success": null
  },
  {
    "id": 5,
    "reward_fuel": 200,
    "reward_bullet": 200,
    "reward_steel": 20,
    "reward_alum": 20,
    "reward_items": [],
    "flagship_lv": 3,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "big_success": null
  },
  {
    "id": 6,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 80,
    "reward_items": [
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 4,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [],
    "big_success": null
  },
  {
    "id": 7,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 50,
    "reward_alum": 30,
    "reward_items": [
      {
        "itemtype": 2,
        "max_number": 1
      }
    ],
    "flagship_lv": 5,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [],
    "big_success": null
  },
  {
    "id": 8,
    "reward_fuel": 50,
    "reward_bullet": 100,
    "reward_steel": 50,
    "reward_alum": 50,
    "reward_items": [
      {
        "itemtype": 2,
        "max_number": 2
      },
      {
        "itemtype": 3,
        "max_number": 1
      }
    ],
    "flagship_lv": 6,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [],
    "big_success": null
  },
  {
    "id": 9,
    "reward_fuel": 350,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 2
      },
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 3,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "big_success": null
  },
  {
    "id": 10,
    "reward_fuel": 0,
    "reward_bullet": 50,
    "reward_steel": 0,
    "reward_alum": 30,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      },
      {
        "itemtype": 2,
        "max_number": 1
      }
    ],
    "flagship_lv": 3,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 3,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          3
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 11,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 250,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      },
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 6,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 12,
    "reward_fuel": 50,
    "reward_bullet": 250,
    "reward_steel": 200,
    "reward_alum": 50,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 1
      },
      {
        "itemtype": 5,
        "max_number": 1
      }
    ],
    "flagship_lv": 4,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 13,
    "reward_fuel": 240,
    "reward_bullet": 300,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 2
      },
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 5,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 4
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "big_success": null
  },
  {
    "id": 14,
    "reward_fuel": 0,
    "reward_bullet": 240,
    "reward_steel": 200,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      },
      {
        "itemtype": 3,
        "max_number": 1
      }
    ],
    "flagship_lv": 6,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 3
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "big_success": null
  },
  {
    "id": 15,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 300,
    "reward_alum": 400,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 1
      },
      {
        "itemtype": 6,
        "max_number": 1
      }
    ],
    "flagship_lv": 9,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          7,
          11,
          16,
          18
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 16,
    "reward_fuel": 500,
    "reward_bullet": 500,
    "reward_steel": 200,
    "reward_alum": 200,
    "reward_items": [
      {
        "itemtype": 2,
        "max_number": 2
      },
      {
        "itemtype": 3,
        "max_number": 2
      }
    ],
    "flagship_lv": 10,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "big_success": null
  },
  {
    "id": 17,
    "reward_fuel": 70,
    "reward_bullet": 70,
    "reward_steel": 50,
    "reward_alum": 0,
    "reward_items": [],
    "flagship_lv": 20,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 3
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "big_success": null
  },
  {
    "id": 18,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 300,
    "reward_alum": 100,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      }
    ],
    "flagship_lv": 15,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          7,
          11,
          16
        ],
        "count": 3
      }
    ],
    "big_success": null
  },
  {
    "id": 19,
    "reward_fuel": 400,
    "reward_bullet": 0,
    "reward_steel": 50,
    "reward_alum": 30,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 1
      },
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 20,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          10
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 20,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 150,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 1
      },
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 1,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 2,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          3
        ],
        "count": 1
      },
      {
        "shiptype": [
          13,
          14
        ],
        "count": 1
      }
    ],
    "big_success": null
  },
  {
    "id": 21,
    "reward_fuel": 320,
    "reward_bullet": 270,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 15,
    "fleet_lv": 30,
    "flagship_shiptype": 0,
    "ship_count": 5,
    "drum_ship_count": 3,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 4
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "big_success": "6只编制, 4只战意高扬, 额外装备1个缶"
  },
  {
    "id": 22,
    "reward_fuel": 0,
    "reward_bullet": 10,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [],
    "flagship_lv": 30,
    "fleet_lv": 45,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      },
      {
        "shiptype": [
          5
        ],
        "count": 1
      }
    ],
    "big_success": null
  },
  {
    "id": 23,
    "reward_fuel": 0,
    "reward_bullet": 20,
    "reward_steel": 0,
    "reward_alum": 100,
    "reward_items": [],
    "flagship_lv": 50,
    "fleet_lv": 200,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          10
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 24,
    "reward_fuel": 500,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 150,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      },
      {
        "itemtype": 3,
        "max_number": 2
      }
    ],
    "flagship_lv": 50,
    "fleet_lv": 200,
    "flagship_shiptype": 3,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 4
      }
    ],
    "big_success": "至少4只战意高扬与4个缶"
  },
  {
    "id": 25,
    "reward_fuel": 900,
    "reward_bullet": 0,
    "reward_steel": 500,
    "reward_alum": 0,
    "reward_items": [],
    "flagship_lv": 25,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          5
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 26,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 900,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 3
      }
    ],
    "flagship_lv": 30,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      },
      {
        "shiptype": [
          7,
          11,
          16
        ],
        "count": 1
      }
    ],
    "big_success": null
  },
  {
    "id": 27,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 800,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 1
      },
      {
        "itemtype": 4,
        "max_number": 2
      }
    ],
    "flagship_lv": 1,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 2,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          13,
          14
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 28,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 900,
    "reward_alum": 350,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 2
      },
      {
        "itemtype": 5,
        "max_number": 2
      }
    ],
    "flagship_lv": 30,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 3,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          13,
          14
        ],
        "count": 3
      }
    ],
    "big_success": null
  },
  {
    "id": 29,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 100,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 1
      },
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 50,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 3,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          13,
          14
        ],
        "count": 3
      }
    ],
    "big_success": null
  },
  {
    "id": 30,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 100,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 3
      }
    ],
    "flagship_lv": 55,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          13,
          14
        ],
        "count": 4
      }
    ],
    "big_success": null
  },
  {
    "id": 31,
    "reward_fuel": 0,
    "reward_bullet": 30,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 60,
    "fleet_lv": 200,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          13,
          14
        ],
        "count": 4
      }
    ],
    "big_success": null
  },
  {
    "id": 32,
    "reward_fuel": 50,
    "reward_bullet": 50,
    "reward_steel": 50,
    "reward_alum": 50,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 3
      },
      {
        "itemtype": 6,
        "max_number": 1
      }
    ],
    "flagship_lv": 5,
    "fleet_lv": 0,
    "flagship_shiptype": 21,
    "ship_count": 3,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      }
    ],
    "big_success": "无战意高扬舰船亦可能大成功"
  },
  {
    "id": 33,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [],
    "flagship_lv": 0,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 2,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 34,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [],
    "flagship_lv": 0,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 2,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 35,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 240,
    "reward_alum": 280,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 1
      },
      {
        "itemtype": 4,
        "max_number": 2
      }
    ],
    "flagship_lv": 40,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 1
      },
      {
        "shiptype": [
          5
        ],
        "count": 1
      },
      {
        "shiptype": [
          7,
          11,
          16,
          18
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 36,
    "reward_fuel": 480,
    "reward_bullet": 0,
    "reward_steel": 200,
    "reward_alum": 200,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      },
      {
        "itemtype": 5,
        "max_number": 2
      }
    ],
    "flagship_lv": 30,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 1
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      },
      {
        "shiptype": [
          16
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 37,
    "reward_fuel": 0,
    "reward_bullet": 380,
    "reward_steel": 270,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 50,
    "fleet_lv": 200,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 3,
    "drum_count": 4,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 5
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "big_success": "6只编制, 4只战意高扬, 额外装备1个缶"
  },
  {
    "id": 38,
    "reward_fuel": 420,
    "reward_bullet": 0,
    "reward_steel": 200,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 65,
    "fleet_lv": 240,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 4,
    "drum_count": 8,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 5
      }
    ],
    "big_success": "6只编制, 4只战意高扬, 额外装备2个缶"
  },
  {
    "id": 39,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 300,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 2
      },
      {
        "itemtype": 5,
        "max_number": 1
      }
    ],
    "flagship_lv": 3,
    "fleet_lv": 180,
    "flagship_shiptype": 0,
    "ship_count": 5,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          13,
          14
        ],
        "count": 4
      },
      {
        "shiptype": [
          20
        ],
        "count": 1
      }
    ],
    "big_success": null
  },
  {
    "id": 40,
    "reward_fuel": 300,
    "reward_bullet": 300,
    "reward_steel": 0,
    "reward_alum": 100,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      },
      {
        "itemtype": 4,
        "max_number": 3
      }
    ],
    "flagship_lv": 25,
    "fleet_lv": 150,
    "flagship_shiptype": 3,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          16
        ],
        "count": 2
      }
    ],
    "big_success": "无战意高扬舰船亦可能大成功"
  },
  {
    "id": 100,
    "reward_fuel": 45,
    "reward_bullet": 45,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      },
      {
        "itemtype": 4,
        "max_number": 1
      }
    ],
    "flagship_lv": 5,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 3
      }
    ],
    "big_success": null
  },
  {
    "id": 101,
    "reward_fuel": 70,
    "reward_bullet": 40,
    "reward_steel": 0,
    "reward_alum": 10,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      },
      {
        "itemtype": 3,
        "max_number": 1
      }
    ],
    "flagship_lv": 20,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 4
      }
    ],
    "required_extra": {
      "asw": 180
    },
    "big_success": null
  },
  {
    "id": 102,
    "reward_fuel": 120,
    "reward_bullet": 0,
    "reward_steel": 60,
    "reward_alum": 60,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      },
      {
        "itemtype": 3,
        "max_number": 2
      }
    ],
    "flagship_lv": 35,
    "fleet_lv": 185,
    "flagship_shiptype": 0,
    "ship_count": 5,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 3
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "required_extra": {
      "asw": 280
    },
    "big_success": null
  },
  {
    "id": 110,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 10,
    "reward_alum": 30,
    "reward_items": [
      {
        "itemtype": 4,
        "max_number": 1
      },
      {
        "itemtype": 1,
        "max_number": 1
      }
    ],
    "flagship_lv": 40,
    "fleet_lv": 150,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          16
        ],
        "count": 1
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "required_extra": {
      "asw": 200,
      "aa": 200,
      "los": 140
    },
    "big_success": null
  },
  {
    "id": 111,
    "reward_fuel": 300,
    "reward_bullet": 200,
    "reward_steel": 100,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 2
      },
      {
        "itemtype": 1,
        "max_number": 2
      }
    ],
    "flagship_lv": 50,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 3
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      },
      {
        "shiptype": [
          5
        ],
        "count": 1
      }
    ],
    "required_extra": {
      "firepower": 360
    },
    "big_success": null
  },
  {
    "id": 165,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [],
    "flagship_lv": 0,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 2,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 166,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [],
    "flagship_lv": 0,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 2,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 41,
    "reward_fuel": 100,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 20,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 1
      },
      {
        "itemtype": 1,
        "max_number": 1
      }
    ],
    "flagship_lv": 30,
    "fleet_lv": 100,
    "flagship_shiptype": 0,
    "ship_count": 0,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 3
      }
    ],
    "required_extra": {
      "firepower": 60,
      "aa": 80,
      "asw": 210
    },
    "big_success": null
  },
  {
    "id": 42,
    "reward_fuel": 800,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 200,
    "reward_items": [
      {
        "itemtype": 12,
        "max_number": 1
      },
      {
        "itemtype": 2,
        "max_number": 3
      }
    ],
    "flagship_lv": 45,
    "fleet_lv": 200,
    "flagship_shiptype": 0,
    "ship_count": 4,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "big_success": null
  },
  {
    "id": 43,
    "reward_fuel": 2000,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 400,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 4
      },
      {
        "itemtype": 7,
        "max_number": 1
      }
    ],
    "flagship_lv": 55,
    "fleet_lv": 300,
    "flagship_shiptype": 7,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 4
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "required_extra": {
      "firepower": 500,
      "aa": 280,
      "asw": 280,
      "los": 170
    },
    "big_success": null
  },
  {
    "id": 44,
    "reward_fuel": 0,
    "reward_bullet": 200,
    "reward_steel": 0,
    "reward_alum": 800,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 4
      },
      {
        "itemtype": 12,
        "max_number": 2
      }
    ],
    "flagship_lv": 35,
    "fleet_lv": 210,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 3,
    "drum_count": 6,
    "required_shiptypes": [
      {
        "shiptype": [
          16
        ],
        "count": 2
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      },
      {
        "shiptype": [
          1,
          2
        ],
        "count": 2
      }
    ],
    "required_extra": {
      "aa": 200,
      "asw": 200,
      "los": 150
    },
    "big_success": null
  },
  {
    "id": 45,
    "reward_fuel": 40,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 220,
    "reward_items": [
      {
        "itemtype": 11,
        "max_number": 1
      }
    ],
    "flagship_lv": 50,
    "fleet_lv": 240,
    "flagship_shiptype": 7,
    "ship_count": 0,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 4
      }
    ],
    "required_extra": {
      "aa": 240,
      "asw": 300,
      "los": 180
    },
    "big_success": null
  },
  {
    "id": 46,
    "reward_fuel": 300,
    "reward_bullet": 0,
    "reward_steel": 150,
    "reward_alum": 380,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 3
      },
      {
        "itemtype": 7,
        "max_number": 1
      }
    ],
    "flagship_lv": 60,
    "fleet_lv": 300,
    "flagship_shiptype": 0,
    "ship_count": 5,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          5
        ],
        "count": 2
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      },
      {
        "shiptype": [
          2
        ],
        "count": 2
      }
    ],
    "required_extra": {
      "firepower": 350,
      "aa": 250,
      "asw": 220,
      "los": 190
    },
    "big_success": null
  },
  {
    "id": 103,
    "reward_fuel": 80,
    "reward_bullet": 120,
    "reward_steel": 0,
    "reward_alum": 100,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 2
      },
      {
        "itemtype": 2,
        "max_number": 2
      }
    ],
    "flagship_lv": 40,
    "fleet_lv": 200,
    "flagship_shiptype": 0,
    "ship_count": 5,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "required_extra": {
      "firepower": 300,
      "aa": 200,
      "asw": 200,
      "los": 120
    },
    "big_success": null
  },
  {
    "id": 104,
    "reward_fuel": 0,
    "reward_bullet": 300,
    "reward_steel": 0,
    "reward_alum": 100,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 4
      },
      {
        "itemtype": 1,
        "max_number": 3
      }
    ],
    "flagship_lv": 45,
    "fleet_lv": 230,
    "flagship_shiptype": 0,
    "ship_count": 5,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 3
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "required_extra": {
      "firepower": 280,
      "aa": 220,
      "asw": 240,
      "los": 150
    },
    "big_success": null
  },
  {
    "id": 105,
    "reward_fuel": 100,
    "reward_bullet": 500,
    "reward_steel": 100,
    "reward_alum": 200,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 5
      },
      {
        "itemtype": 7,
        "max_number": 1
      }
    ],
    "flagship_lv": 55,
    "fleet_lv": 290,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          1,
          2
        ],
        "count": 3
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      }
    ],
    "required_extra": {
      "firepower": 330,
      "aa": 300,
      "asw": 270,
      "los": 180
    },
    "big_success": null
  },
  {
    "id": 112,
    "reward_fuel": 0,
    "reward_bullet": 100,
    "reward_steel": 100,
    "reward_alum": 180,
    "reward_items": [
      {
        "itemtype": 12,
        "max_number": 1
      },
      {
        "itemtype": 1,
        "max_number": 2
      }
    ],
    "flagship_lv": 50,
    "fleet_lv": 250,
    "flagship_shiptype": 0,
    "ship_count": 0,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          16
        ],
        "count": 1
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      },
      {
        "shiptype": [
          1,
          2
        ],
        "count": 4
      }
    ],
    "required_extra": {
      "firepower": 400,
      "aa": 220,
      "asw": 220,
      "los": 190
    },
    "big_success": null
  },
  {
    "id": 113,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 1200,
    "reward_alum": 650,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 4
      },
      {
        "itemtype": 7,
        "max_number": 1
      }
    ],
    "flagship_lv": 55,
    "fleet_lv": 300,
    "flagship_shiptype": 0,
    "ship_count": 0,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          5
        ],
        "count": 2
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      },
      {
        "shiptype": [
          2
        ],
        "count": 2
      },
      {
        "shiptype": [
          13,
          14
        ],
        "count": 1
      }
    ],
    "required_extra": {
      "firepower": 500,
      "aa": 280,
      "asw": 280,
      "los": 170
    },
    "big_success": null
  },
  {
    "id": 114,
    "reward_fuel": 500,
    "reward_bullet": 500,
    "reward_steel": 1000,
    "reward_alum": 750,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 4
      },
      {
        "itemtype": 7,
        "max_number": 1
      }
    ],
    "flagship_lv": 60,
    "fleet_lv": 330,
    "flagship_shiptype": 0,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          16
        ],
        "count": 1
      },
      {
        "shiptype": [
          3
        ],
        "count": 1
      },
      {
        "shiptype": [
          2
        ],
        "count": 2
      }
    ],
    "required_extra": {
      "firepower": 510,
      "aa": 400,
      "asw": 285,
      "los": 385
    },
    "big_success": null
  },
  {
    "id": 115,
    "reward_fuel": 600,
    "reward_bullet": 1000,
    "reward_steel": 600,
    "reward_alum": 600,
    "reward_items": [
      {
        "itemtype": 3,
        "max_number": 5
      },
      {
        "itemtype": 7,
        "max_number": 1
      }
    ],
    "flagship_lv": 75,
    "fleet_lv": 400,
    "flagship_shiptype": 3,
    "ship_count": 0,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 5
      }
    ],
    "required_extra": {
      "firepower": 410,
      "aa": 390,
      "asw": 410,
      "los": 340
    },
    "big_success": null
  },
  {
    "id": 131,
    "reward_fuel": 0,
    "reward_bullet": 20,
    "reward_steel": 20,
    "reward_alum": 100,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 1
      }
    ],
    "flagship_lv": 50,
    "fleet_lv": 200,
    "flagship_shiptype": 16,
    "ship_count": 5,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 3
      }
    ],
    "required_extra": {
      "aa": 240,
      "asw": 240,
      "los": 300
    },
    "big_success": null
  },
  {
    "id": 132,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 400,
    "reward_alum": 800,
    "reward_items": [
      {
        "itemtype": 59,
        "max_number": 1
      },
      {
        "itemtype": 12,
        "max_number": 1
      }
    ],
    "flagship_lv": 55,
    "fleet_lv": 270,
    "flagship_shiptype": 20,
    "ship_count": 5,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          13,
          14
        ],
        "count": 3
      }
    ],
    "required_extra": {
      "firepower": 60,
      "aa": 80,
      "asw": 50
    },
    "big_success": null
  },
  {
    "id": 133,
    "reward_fuel": 0,
    "reward_bullet": 800,
    "reward_steel": 500,
    "reward_alum": 400,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 3
      },
      {
        "itemtype": 7,
        "max_number": 1
      }
    ],
    "flagship_lv": 65,
    "fleet_lv": 350,
    "flagship_shiptype": 20,
    "ship_count": 5,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          13,
          14
        ],
        "count": 3
      }
    ],
    "required_extra": {
      "firepower": 115,
      "aa": 90,
      "asw": 70,
      "los": 95
    },
    "big_success": null
  },
  {
    "id": 141,
    "reward_fuel": 0,
    "reward_bullet": 600,
    "reward_steel": 600,
    "reward_alum": 1000,
    "reward_items": [
      {
        "itemtype": 12,
        "max_number": 2
      },
      {
        "itemtype": 7,
        "max_number": 1
      }
    ],
    "flagship_lv": 55,
    "fleet_lv": 290,
    "flagship_shiptype": 5,
    "ship_count": 6,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          3
        ],
        "count": 1
      },
      {
        "shiptype": [
          2
        ],
        "count": 3
      }
    ],
    "required_extra": {
      "firepower": 450,
      "aa": 350,
      "asw": 330,
      "los": 250
    },
    "big_success": null
  },
  {
    "id": 142,
    "reward_fuel": 0,
    "reward_bullet": 480,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [
      {
        "itemtype": 1,
        "max_number": 2
      },
      {
        "itemtype": 7,
        "max_number": 1
      }
    ],
    "flagship_lv": 70,
    "fleet_lv": 320,
    "flagship_shiptype": 0,
    "ship_count": 0,
    "drum_ship_count": 3,
    "drum_count": 4,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 5
      }
    ],
    "required_extra": {
      "firepower": 280,
      "aa": 240,
      "asw": 200,
      "los": 160
    },
    "big_success": null
  },
  {
    "id": 301,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [],
    "flagship_lv": 0,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 2,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      }
    ],
    "big_success": null
  },
  {
    "id": 302,
    "reward_fuel": 0,
    "reward_bullet": 0,
    "reward_steel": 0,
    "reward_alum": 0,
    "reward_items": [],
    "flagship_lv": 0,
    "fleet_lv": 0,
    "flagship_shiptype": 0,
    "ship_count": 2,
    "drum_ship_count": 0,
    "drum_count": 0,
    "required_shiptypes": [
      {
        "shiptype": [
          2
        ],
        "count": 2
      }
    ],
    "big_success": null
  }
];

export default data;
