window.DEMO = {
  "generatedAt": "2026-09-02T11:40:25.530Z",
  "network": "Coston2 (chain 114)",
  "ftso": "0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d",
  "registry": "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
  "platform": null,
  "rebalancer": null,
  "attestedBy": "preview (no on-chain rebalance) - set PK + run the tee-node to attest",
  "preview": true,
  "feeBps": 200,
  "platformRevenueFlr": 7,
  "flrUsd": 0.00657996,
  "baseline": {
    "FLR": 0.00657996,
    "BTC": 76646.9,
    "ETH": 2378.788,
    "XRP": 1.322115,
    "SOL": 98.0836,
    "AVAX": 7.11582,
    "DOGE": 0.081098
  },
  "baskets": [
    {
      "id": "wall-street-financials",
      "name": "Wall Street Financials",
      "prompt": "Concentrate on money-center banking and card-network rails: a bank, the two card networks, and an investment bank.",
      "kind": "rwa",
      "vault": null,
      "aumFlr": 50,
      "aumUsd": 0.328998,
      "feeFlr": 1,
      "positions": [
        {
          "sym": "JPMx",
          "weight": 35,
          "units": 0.0003228907520610173,
          "basePx": 356.62,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.22543299999999997
        },
        {
          "sym": "Vx",
          "weight": 25,
          "units": 0.00021514386607376405,
          "basePx": 382.3,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.011852000000000001
        },
        {
          "sym": "MAx",
          "weight": 25,
          "units": 0.00013763994176414478,
          "basePx": 597.57,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.07476100000000002
        },
        {
          "sym": "GSx",
          "weight": 15,
          "units": 0.00004792210062245701,
          "basePx": 1029.79,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.216618
        }
      ],
      "weekReturn": 0.13304749999999999,
      "rank": 1
    },
    {
      "id": "ai-semiconductors",
      "name": "AI & Semiconductors",
      "prompt": "Build a basket of the picks-and-shovels of the AI buildout: GPU, foundry and memory names, overweight the compute leader.",
      "kind": "rwa",
      "vault": null,
      "aumFlr": 50,
      "aumUsd": 0.328998,
      "feeFlr": 1,
      "positions": [
        {
          "sym": "NVDAx",
          "weight": 30,
          "units": 0.00045111476758535586,
          "basePx": 218.79,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.097551
        },
        {
          "sym": "AVGOx",
          "weight": 18,
          "units": 0.00016195274298528686,
          "basePx": 365.66,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.10739800000000002
        },
        {
          "sym": "TSMx",
          "weight": 16,
          "units": 0.00012573672518810463,
          "basePx": 418.65,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": -0.045209
        },
        {
          "sym": "ASMLx",
          "weight": 14,
          "units": 0.000026824133713819818,
          "basePx": 1717.1,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.109075
        },
        {
          "sym": "AMDx",
          "weight": 14,
          "units": 0.0000990723365812738,
          "basePx": 464.91,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.204062
        },
        {
          "sym": "MUx",
          "weight": 8,
          "units": 0.00002832008780141386,
          "basePx": 929.37,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.10628000000000001
        }
      ],
      "weekReturn": 0.09370508000000011,
      "rank": 2
    },
    {
      "id": "mag-7-tokenized",
      "name": "Mag-7 Tokenized",
      "prompt": "Hold the seven mega-cap US tech names as tokenized equities, weighted by market cap and tilted to the largest.",
      "kind": "rwa",
      "vault": null,
      "aumFlr": 50,
      "aumUsd": 0.328998,
      "feeFlr": 1,
      "positions": [
        {
          "sym": "NVDAx",
          "weight": 20,
          "units": 0.0003007431783902372,
          "basePx": 218.79,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": -0.011754999999999988
        },
        {
          "sym": "AAPLx",
          "weight": 18,
          "units": 0.0002027306151792133,
          "basePx": 292.11,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.201869
        },
        {
          "sym": "MSFTx",
          "weight": 18,
          "units": 0.00011651216872921872,
          "basePx": 508.27,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.098411
        },
        {
          "sym": "AMZNx",
          "weight": 14,
          "units": 0.0001739152695967377,
          "basePx": 264.84,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": -0.13314399999999998
        },
        {
          "sym": "GOOGLx",
          "weight": 12,
          "units": 0.00011314521537271086,
          "basePx": 348.93,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.12274899999999997
        },
        {
          "sym": "METAx",
          "weight": 10,
          "units": 0.00005379476111056607,
          "basePx": 611.58,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.24611600000000003
        },
        {
          "sym": "TSLAx",
          "weight": 8,
          "units": 0.0000680979042690815,
          "basePx": 386.5,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.02286000000000002
        }
      ],
      "weekReturn": 0.07422952000000049,
      "rank": 3
    },
    {
      "id": "consumer-brands",
      "name": "Consumer Brands",
      "prompt": "Defensive consumer staples and brands with pricing power: warehouse retail, big-box, fast food, beverages, coffee and apparel.",
      "kind": "rwa",
      "vault": null,
      "aumFlr": 50,
      "aumUsd": 0.328998,
      "feeFlr": 1,
      "positions": [
        {
          "sym": "COSTon",
          "weight": 22,
          "units": 0.00007653867140409873,
          "basePx": 945.66,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Ondo Global Markets Bvi Limited",
          "drift": 0.206771
        },
        {
          "sym": "WMTx",
          "weight": 20,
          "units": 0.0006311712230215827,
          "basePx": 104.25,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.046381000000000006
        },
        {
          "sym": "MCDx",
          "weight": 18,
          "units": 0.0002218130197018503,
          "basePx": 266.98,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.10034600000000002
        },
        {
          "sym": "KOx",
          "weight": 16,
          "units": 0.0005802433862433863,
          "basePx": 90.72,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.07183700000000001
        },
        {
          "sym": "SBUXon",
          "weight": 14,
          "units": 0.0004299423130775694,
          "basePx": 107.13,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Ondo Global Markets Bvi Limited",
          "drift": -0.0010479999999999934
        },
        {
          "sym": "NKEon",
          "weight": 10,
          "units": 0.0008507835531419705,
          "basePx": 38.67,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Ondo Global Markets Bvi Limited",
          "drift": -0.09947500000000001
        }
      ],
      "weekReturn": 0.07422779999999984,
      "rank": 4
    },
    {
      "id": "precious-metals",
      "name": "Precious Metals Basket",
      "prompt": "Tokenized precious metals as an inflation hedge, priced live on FTSO where available: gold-heavy, with silver, platinum and palladium.",
      "kind": "rwa",
      "vault": null,
      "aumFlr": 50,
      "aumUsd": 0.328998,
      "feeFlr": 1,
      "positions": [
        {
          "sym": "XAUT0",
          "weight": 50,
          "units": 0.00004076802973977695,
          "basePx": 4035,
          "source": "csv",
          "assetClass": "precious-metals",
          "issuer": "Usdt0 Network Xaut0 Deployments",
          "drift": -0.096852
        },
        {
          "sym": "SLV",
          "weight": 25,
          "units": 0.0012081301410105758,
          "basePx": 68.08,
          "source": "csv",
          "assetClass": "precious-metals",
          "issuer": "Robinhood Markets Inc",
          "drift": 0.126576
        },
        {
          "sym": "PPLTon",
          "weight": 15,
          "units": 0.000027370881863560732,
          "basePx": 1803,
          "source": "csv",
          "assetClass": "precious-metals",
          "issuer": "Ondo Global Markets Bvi Limited",
          "drift": 0.198257
        },
        {
          "sym": "PALLx",
          "weight": 10,
          "units": 0.000023754368231046932,
          "basePx": 1385,
          "source": "csv",
          "assetClass": "precious-metals",
          "issuer": "Backed Assets Je Limited",
          "drift": -0.08403799999999999
        }
      ],
      "weekReturn": 0.004552749999999994,
      "rank": 5
    },
    {
      "id": "crypto-equity-complex",
      "name": "Crypto-Equity Complex",
      "prompt": "Get equity-market exposure to the crypto economy: an exchange, a bitcoin treasury, a stablecoin issuer and a retail broker.",
      "kind": "rwa",
      "vault": null,
      "aumFlr": 50,
      "aumUsd": 0.328998,
      "feeFlr": 1,
      "positions": [
        {
          "sym": "COINx",
          "weight": 35,
          "units": 0.0006183176716962896,
          "basePx": 186.23,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": -0.0003599999999999992
        },
        {
          "sym": "MSTRx",
          "weight": 30,
          "units": 0.0005921135041094247,
          "basePx": 166.69,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": -0.066021
        },
        {
          "sym": "HOODx",
          "weight": 20,
          "units": 0.0005809093316853536,
          "basePx": 113.27,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": -0.13972299999999999
        },
        {
          "sym": "CRCLx",
          "weight": 15,
          "units": 0.0006165629685157421,
          "basePx": 80.04,
          "source": "csv",
          "assetClass": "public-equities",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.0693
        }
      ],
      "weekReturn": -0.03748190000000018,
      "rank": 6
    },
    {
      "id": "tokenized-index-funds",
      "name": "Tokenized Index Funds",
      "prompt": "A one-line broad-market allocation using tokenized ETFs: large-cap core, Nasdaq growth tilt, small-cap kicker.",
      "kind": "rwa",
      "vault": null,
      "aumFlr": 50,
      "aumUsd": 0.328998,
      "feeFlr": 1,
      "positions": [
        {
          "sym": "SPYx",
          "weight": 50,
          "units": 0.00002212494956287828,
          "basePx": 7435,
          "source": "csv",
          "assetClass": "equity-indices",
          "issuer": "Backed Assets Je Limited",
          "drift": -0.10097999999999999
        },
        {
          "sym": "QQQx",
          "weight": 35,
          "units": 0.00016115390536436538,
          "basePx": 714.53,
          "source": "csv",
          "assetClass": "equity-indices",
          "issuer": "Backed Assets Je Limited",
          "drift": -0.076513
        },
        {
          "sym": "IWMx",
          "weight": 15,
          "units": 0.00016530347692101562,
          "basePx": 298.54,
          "source": "csv",
          "assetClass": "equity-indices",
          "issuer": "Backed Assets Je Limited",
          "drift": 0.150699
        }
      ],
      "weekReturn": -0.05466470000000001,
      "rank": 7
    }
  ]
};
