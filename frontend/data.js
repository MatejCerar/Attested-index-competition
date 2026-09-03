window.DEMO = {
  "generatedAt": "2026-09-03T05:38:55.254Z",
  "network": "Coston2 (chain 114)",
  "stable": "0x0000000000000000000000000000000000000000 (sample, run orchestrator for live)",
  "platform": "0x4AD9F5F107c54264A5d107dEb10f768a9d27b8b7",
  "rebalancer": "0x5Cd9677f9D300a3af64783629B3B281b7217bC54",
  "attestedBy": "real Flare tee-node v0.0.24 (FCC) - signs each on-chain rebalance",
  "feeBps": 200,
  "platformRevenueUsd": 100,
  "sample": true,
  "baseline": {
    "BTC": 76769.05,
    "ETH": 2384.558,
    "XRP": 1.330262,
    "SOL": 99.0116,
    "AVAX": 7.14331,
    "DOGE": 0.081039,
    "FLR": 0.00657099
  },
  "indices": [
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
      "strategy": "hourly",
      "strategyName": "Hourly",
      "rebalanceReason": "initial allocation",
      "vault": "0x0000000000000000000000000000000000000000",
      "depositUsd": 1000,
      "feeUsd": 20,
      "depositTx": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "rebalanceTx": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "positions": [
        {
          "sym": "ETH",
          "weight": 45,
          "units": 0.1887142187357154,
          "basePx": 2384.558,
          "drift": 0.003381000000000023
        },
        {
          "sym": "SOL",
          "weight": 35,
          "units": 3.534939340440918,
          "basePx": 99.0116,
          "drift": 0.12778000000000003
        },
        {
          "sym": "AVAX",
          "weight": 20,
          "units": 27.998224912540547,
          "basePx": 7.14331,
          "drift": 0.099744
        }
      ],
      "weekReturn": 0.06619324999999998,
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
      "strategy": "drift-5pct",
      "strategyName": "Drift 5%",
      "rebalanceReason": "initial allocation",
      "vault": "0x0000000000000000000000000000000000000000",
      "depositUsd": 1000,
      "feeUsd": 20,
      "depositTx": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "rebalanceTx": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "positions": [
        {
          "sym": "BTC",
          "weight": 60,
          "units": 0.007815649666108933,
          "basePx": 76769.05,
          "drift": 0.02277399999999999
        },
        {
          "sym": "ETH",
          "weight": 40,
          "units": 0.16774597220952478,
          "basePx": 2384.558,
          "drift": -0.033814
        }
      ],
      "weekReturn": 0.00013879999999999448,
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
      "strategy": "five-minute",
      "strategyName": "Five minute",
      "rebalanceReason": "initial allocation",
      "vault": "0x0000000000000000000000000000000000000000",
      "depositUsd": 1000,
      "feeUsd": 20,
      "depositTx": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "rebalanceTx": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "positions": [
        {
          "sym": "FLR",
          "weight": 60,
          "units": 91310.44180557269,
          "basePx": 0.00657099,
          "drift": -0.101238
        },
        {
          "sym": "XRP",
          "weight": 40,
          "units": 300.6926455089298,
          "basePx": 1.330262,
          "drift": 0.140336
        }
      ],
      "weekReturn": -0.004608399999999957,
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
      "strategy": "hourly-or-drift",
      "strategyName": "Hourly or 5% drift",
      "rebalanceReason": "initial allocation",
      "vault": "0x0000000000000000000000000000000000000000",
      "depositUsd": 1000,
      "feeUsd": 20,
      "depositTx": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "rebalanceTx": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "positions": [
        {
          "sym": "SOL",
          "weight": 40,
          "units": 4.039930674789621,
          "basePx": 99.0116,
          "drift": 0.013744000000000006
        },
        {
          "sym": "DOGE",
          "weight": 40,
          "units": 4935.895062870964,
          "basePx": 0.081039,
          "drift": -0.0072399999999999964
        },
        {
          "sym": "AVAX",
          "weight": 20,
          "units": 27.998224912540547,
          "basePx": 7.14331,
          "drift": -0.09332599999999999
        }
      ],
      "weekReturn": -0.016063600000000067,
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
      "strategy": "ten-minute",
      "strategyName": "Ten minute",
      "rebalanceReason": "initial allocation",
      "vault": "0x0000000000000000000000000000000000000000",
      "depositUsd": 1000,
      "feeUsd": 20,
      "depositTx": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "rebalanceTx": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "positions": [
        {
          "sym": "XRP",
          "weight": 70,
          "units": 526.2121296406272,
          "basePx": 1.330262,
          "drift": -0.125662
        },
        {
          "sym": "FLR",
          "weight": 30,
          "units": 45655.22090278634,
          "basePx": 0.00657099,
          "drift": 0.15444
        }
      ],
      "weekReturn": -0.041631399999999985,
      "rank": 5
    }
  ]
};
