window.DEMO = {
  "generatedAt": "2026-09-02T09:27:40.411Z",
  "network": "Coston2 (chain 114)",
  "ftso": "0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d",
  "platform": "0x4AD9F5F107c54264A5d107dEb10f768a9d27b8b7",
  "rebalancer": "0x5Cd9677f9D300a3af64783629B3B281b7217bC54",
  "attestedBy": "real Flare tee-node v0.0.24 (FCC) - signs each on-chain rebalance",
  "feeBps": 200,
  "platformRevenueFlr": 5,
  "flrUsd": 0.00657099,
  "baseline": {
    "FLR": 0.00657099,
    "BTC": 76769.05,
    "ETH": 2384.558,
    "XRP": 1.330262,
    "SOL": 99.0116,
    "AVAX": 7.14331,
    "DOGE": 0.081039
  },
  "baskets": [
    {
      "id": "l1-index",
      "name": "Smart-Contract L1 Index",
      "prompt": "Build a basket of leading smart-contract layer-1s, tilted to liquidity.",
      "rationale": "ETH as the base layer, SOL for throughput/retail flow, AVAX for subnet optionality.",
      "weights": {
        "ETH": 45,
        "SOL": 35,
        "AVAX": 20
      },
      "vault": "0xd5Cb1ccf4aB347428871421F3bC8C34153a94079",
      "depositor": "0x5937c4D448A6746C326952A656eC437CfE79115C",
      "aumFlr": 50,
      "aumUsd": 0.3285495,
      "feeFlr": 1,
      "feeTx": "0x1024869584db520aa14b8b09ce49b0b731f683e0944eb924c5d366e689aec58c",
      "depositTx": "0x4d5f49b762b37707ecdd16634300bb793eec68631730c195939596b493b95acd",
      "rebalanceTx": "0x2b989caef8d612119db5c6e2e661641b91c2f281688c40ab731bfd60ff92c82d",
      "positions": [
        {
          "sym": "ETH",
          "weight": 45,
          "units": 0.000062001962208509,
          "basePx": 2384.558,
          "drift": 0.003381000000000023
        },
        {
          "sym": "SOL",
          "weight": 35,
          "units": 0.001161402552832193,
          "basePx": 99.0116,
          "drift": 0.12778000000000003
        },
        {
          "sym": "AVAX",
          "weight": 20,
          "units": 0.00919880279590274,
          "basePx": 7.14331,
          "drift": 0.099744
        }
      ],
      "weekReturn": 0.06619325000000043,
      "rank": 1
    },
    {
      "id": "blue-chip",
      "name": "Blue-Chip Store of Value",
      "prompt": "Weight the two most liquid, institutionally-held crypto assets by market dominance.",
      "rationale": "BTC leads on dominance and custody depth; ETH adds settlement and yield. Two names, minimal noise.",
      "weights": {
        "BTC": 60,
        "ETH": 40
      },
      "vault": "0xF8388135B56B56308dD68071241A7eEfA4F8BA15",
      "depositor": "0x3A74e50EC3b1BA589CBB048030deC8DfB7Dc73A2",
      "aumFlr": 50,
      "aumUsd": 0.3285495,
      "feeFlr": 1,
      "feeTx": "0xc4f4cd8c91a9e6c6d20b5e5def7de1448992f563985871138fb4efb777a88e37",
      "depositTx": "0xe3b1127c7da026451737ba64719df306c10cb799381f3b271e8d27e1f56bb961",
      "rebalanceTx": "0x5659292971f29b91a4ad9d130bf85b3910e556802086fe1bb30473e00e9beb0f",
      "positions": [
        {
          "sym": "BTC",
          "weight": 60,
          "units": 0.000002567827789975,
          "basePx": 76769.05,
          "drift": 0.02277399999999999
        },
        {
          "sym": "ETH",
          "weight": 40,
          "units": 0.000055112855296453,
          "basePx": 2384.558,
          "drift": -0.033814
        }
      ],
      "weekReturn": 0.00013879999999888426,
      "rank": 2
    },
    {
      "id": "flare-native",
      "name": "Flare Ecosystem",
      "prompt": "Overweight Flare and its flagship FAssets collateral asset.",
      "rationale": "FLR as the native gas/stake asset, XRP as the first FAsset (FXRP) collateral. Ecosystem-aligned.",
      "weights": {
        "FLR": 60,
        "XRP": 40
      },
      "vault": "0xBdA9333A8e69A341103e195e2A8207D1A9ddaCC1",
      "depositor": "0x037090FC9852163096E9Ae3E2410C629A842270b",
      "aumFlr": 50,
      "aumUsd": 0.3285495,
      "feeFlr": 1,
      "feeTx": "0x80d31a0992f683235517281961e4295100e78bfac38273d5568821a150a2c056",
      "depositTx": "0xc80bd8c8c51b2256aa38d5a61866d93a47685a425feda8f8f42acd0d68aa9e54",
      "rebalanceTx": "0x2c95de6f7a27a387aad553ae8231c716120bb22662e8ab923206f48df9c36d31",
      "positions": [
        {
          "sym": "FLR",
          "weight": 60,
          "units": 30,
          "basePx": 0.00657099,
          "drift": -0.101238
        },
        {
          "sym": "XRP",
          "weight": 40,
          "units": 0.09879241833563615,
          "basePx": 1.330262,
          "drift": 0.140336
        }
      ],
      "weekReturn": -0.004608400000000068,
      "rank": 3
    },
    {
      "id": "high-beta",
      "name": "High-Beta Momentum",
      "prompt": "Maximize exposure to high-volatility momentum names for a risk-on week.",
      "rationale": "SOL and DOGE carry the most retail beta; AVAX amplifies on up-moves. High risk, high spread.",
      "weights": {
        "SOL": 40,
        "DOGE": 40,
        "AVAX": 20
      },
      "vault": "0x2acB442AD2D1Fb2C1A0DFeded9F1bdbfC719a43f",
      "depositor": "0xEd710832e801539Dc9d53CF186512A1127d7ec0f",
      "aumFlr": 50,
      "aumUsd": 0.3285495,
      "feeFlr": 1,
      "feeTx": "0x87f5357bd6fc48d9624aca12c5f6835b585ba785b359ff34194a2b76c4ccaac0",
      "depositTx": "0x1da1e63acc543806c8da14168cdea56b0eee688693b12debc4223e64183c3ccb",
      "rebalanceTx": "0x73bcd49b0df29ee6326ce6d9f0679327fdd7ab8e111c946dad2ab56b299789c5",
      "positions": [
        {
          "sym": "SOL",
          "weight": 40,
          "units": 0.001327317203236792,
          "basePx": 99.0116,
          "drift": 0.013744000000000006
        },
        {
          "sym": "DOGE",
          "weight": 40,
          "units": 1.6216858549587236,
          "basePx": 0.081039,
          "drift": -0.0072399999999999964
        },
        {
          "sym": "AVAX",
          "weight": 20,
          "units": 0.00919880279590274,
          "basePx": 7.14331,
          "drift": -0.09332599999999999
        }
      ],
      "weekReturn": -0.016063599999999956,
      "rank": 4
    },
    {
      "id": "payments",
      "name": "Payments & Settlement",
      "prompt": "Assets used primarily for cross-border value transfer and settlement.",
      "rationale": "XRP is the payments primitive; FLR adds FAssets/data connectivity to the same thesis.",
      "weights": {
        "XRP": 70,
        "FLR": 30
      },
      "vault": "0xb376ADb4EF3B05BEc542237d52A6A5678eF004f6",
      "depositor": "0x9979fF722f244fDbe4697e13E472521aEdC6E9Fe",
      "aumFlr": 50,
      "aumUsd": 0.3285495,
      "feeFlr": 1,
      "feeTx": "0x8cfcce1536840376cd8546e96b8008a816d5978b18475f53927d0b57ab625020",
      "depositTx": "0xa6e521af794a73b094dc4144d52ea613f83619d6e907602fe7190b828dc11e24",
      "rebalanceTx": "0xed280416a830393a2b92869ec76ee62ba28545eb7917b1e481816a47d86eb6d8",
      "positions": [
        {
          "sym": "XRP",
          "weight": 70,
          "units": 0.17288673208736324,
          "basePx": 1.330262,
          "drift": -0.125662
        },
        {
          "sym": "FLR",
          "weight": 30,
          "units": 15,
          "basePx": 0.00657099,
          "drift": 0.15444
        }
      ],
      "weekReturn": -0.041631399999999874,
      "rank": 5
    }
  ]
};
