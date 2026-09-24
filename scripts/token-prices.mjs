// 24/7 token prices: the PRIMARY tier of the price oracle. Tokenized stocks
// and ETFs (Backed xStocks on Solana) price off Jupiter price v3 by mint;
// tokenized metals (PAXG/XAUT/KAG) off CoinGecko. These venues trade nights
// and weekends, so covered names move around the clock. Keyed by the engine
// leg symbol (bare underlying: AAPL, NVDA, GC=F). Never throws; a failed or
// missing fetch just omits the symbol.

// Jupiter mint per bare underlying (from lite-api.jup.ag tokens/v2, verified
// "xstocks" tag, resolved 2026-09-24).
const JUP_MINT = {
    "AAOI": "XsGHwSbPaUJu6r5dtJLHXkXenPgCQf4Sx2hb4e2sbCZ",
    "AAPL": "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    "ABBV": "XswbinNKyPmzTa5CskMbCPvMW6G5CMnZXZEeQSSQoie",
    "ABT": "XsHtf5RpxsQ7jeJ9ivNewouZKJHbPxhPoEy6yYvULr7",
    "ACN": "Xs5UJzmCRQ8DWZjskExdSQDnbE6iLkRu2jjrRAB1JSU",
    "ADSK": "Xs2jBYo5VxMmuNjpBnMShsLB26dtK75bt42ag93ZdHU",
    "ALL": "Xs1kbMkmahb44LPLLdjscSYZ4c2HUu4WNfgk8P7ndQf",
    "AMAT": "XsQZdaWUAGC4R3fgD2N1fupKvJfJq6YM51ccnsLUWFA",
    "AMBR": "XsaQTCgebC2KPbf27KUhdv5JFvHhQ4GDAPURwrEhAzb",
    "AMD": "XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF",
    "AMZN": "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
    "ANET": "XsrsM2RgtYxXqxmy4iWgxQJUkkHG1U5wzi74sVNUW8m",
    "APLD": "Xs2ZEuDVSQkNnXHqfqEYKVShLHpecyKfdfpEYwiHtQE",
    "APP": "XsPdAVBi8Zc1xvv53k4JcMrQaEDTgkGqKYeh7AYgPHV",
    "ARM": "XswUFSYE5CWsZM3X3yo6e2pZvxcAzx912DonGvgUFka",
    "ASML": "XshuHQ6o6SVpUNawvnnTMxsZ4tacZsNgVCLorv7TkFq",
    "ASTS": "XsR4LAtaBgTKTRUhiijY1ba13nx4bepeEcag2Pr4dZ1",
    "AVGO": "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo",
    "AXON": "Xshh7vNfHqyqbnfuvhn8o53wXcuUbBYKASPq8DEHPbx",
    "AXTI": "XswiwGt897dzZU8eHoojgUu2ka34brmPGvWeVHcHho9",
    "AZN": "Xs3ZFkPYT2BN7qBMqf1j1bfTeTm1rFzEFSsQ1z3wAKU",
    "BA": "XsBcnKnZMsPaerLiUQ4eMFy4Fjysot4RugYXYDjiqCP",
    "BAC": "XswsQk4duEQmCbGzfqUUWYmi7pV7xpJ9eEmLHXCaEQP",
    "BMNR": "XsrBCwaH8c46xiqXBChzobgufRKxQxAWUWbndgBNzFn",
    "BMY": "Xsa3dm4UT6TdzPJV75UiuGUeGywYUnfSNhsV5nHPZEu",
    "BRK.B": "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x",
    "BSP": "XsYMHtwJcWon5GkPHzdDbCCztKtKzEurJnbydxgjsqS",
    "BTBT": "XsPLBFy59Q3hY59KLAJur8QyvziMF4xUxGTxXqXE7cT",
    "CAT": "XsRvd1meWQ9kW1SrZPa1jokQqmBoPWWjd6wGTgdp5E6",
    "CBRS": "Xstq9oUsBPd8LSyivHhnt8P8t9xK5RYoM9P6izLczvm",
    "CEG": "Xssu2cDLdZXZYrq17frTVrb3meumRCAzEf7pXyxoWVN",
    "CIEN": "XsE5qZhg6oL1ypWwtwXPQtW1EpFSvRmLXk9ceX9TtZx",
    "CLSK": "Xsn3H7ACEpSF2ULxeiD6kW4jRZXpurh8ZPttyfoS56W",
    "CMCSA": "XsvKCaNsxg2GN8jjUmq71qukMJr7Q1c5R2Mk9P8kcS8",
    "COHR": "XsipFyePxrgwZJrX4s26RJ25cqwpkfn6ec8JLy26w5b",
    "COIN": "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
    "CRCL": "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    "CRM": "XsczbcQ3zfcgAEt9qHQES8pxKAVG5rujPSHQEXi4kaN",
    "CRWD": "Xs7xXqkcK7K8urEqGg52SECi79dRp2cEKKuYjUePYDw",
    "CRWV": "Xs3trfdPXSZuxBJsgau6HRfu8SdrCirkwHpPNgSpJz9",
    "CSCO": "Xsr3pdLQyXvDJBFgpR5nexCEZwXvigb8wbPYp4YoNFf",
    "CVX": "XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts",
    "DELL": "Xsu7Tc5J2fVUE4H5vYAiSr34cvLJeCsYPMjAYnayQn6",
    "DFDV": "Xs2yquAgsHByNzx68WJC55WHjHBvG9JsMB7CWjTLyPy",
    "DIS": "Xsg93jDV656ULQ5u9yT2x5DS9b4xGD8aDCtfESSW6Bb",
    "DRAM": "XsESMQjWyDczCfiJ3QDjZEiaKwp1uXYp3TMZ6viuLcm",
    "EWY": "XswenHXJtDWYMh89uRYx2tZcABxwXSn7j3jidDPS1Yo",
    "F": "XsBNJXGu68cBH5hgFxdqZkeh8cMQv32jeEtZtYTYvfS",
    "FANG": "XsdLjeamzdsWW5aBhsGVAaQFcZtCL6yF9nhtWfszGT3",
    "GEV": "XswXzAsMV9kebQjCVtr1btvrQgQ7C4C9kKgH4QYAVzw",
    "GLD": "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    "GLW": "Xsg3UgvjxpUgV3WZx9Wt9deLx7qvKYp6ZLY6xMY2Dfq",
    "GLXY": "Xs3c2aZenyRQwXjki5MDxJEJ2km27ef2rWQMFWx7QKJ",
    "GME": "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc",
    "GOOGL": "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    "GS": "XsgaUyp4jd1fNBCxgtTKkW64xnnhQcvgaxzsbAq5ZD1",
    "HD": "XszjVtyhowGjSC5odCqBpW1CtXXwXjYokymrk7fGKD3",
    "HON": "XsRbLZthfABAPAfumWNEJhPyiKDW6TvDVeAeW7oKqA2",
    "HOOD": "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
    "IBM": "XspwhyYPdWVM8XBHZnpS9hgyag9MKjLRyE3tVfmCbSr",
    "IJR": "XsyZcb97BzETAqi9BoP2C9D196MiMNBisGMVNje2Thz",
    "INTC": "XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM",
    "IREN": "Xshh1dRsnxatP45yBfrzU9MrvrFCvxHQGTrWjgdA81E",
    "ISRG": "XsgBcHP3frsQGHr5EoDdoPZMANk52Y4JPg5BYx98NwL",
    "IWM": "XsbELVbLGBkn7xfMfyYuUipKGt1iRUc2B7pYRvFTFu3",
    "JNJ": "XsGVi5eo1Dh2zUpic4qACcjuWGjNv8GCt3dm5XcX6Dn",
    "JPM": "XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C",
    "KLAC": "Xsw2uU1i8tHjbgstUbtt3m6kg7BS7AgG5aj8z7ddmmN",
    "KO": "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ",
    "LIN": "XsSr8anD1hkvNMu8XQiVcmiaTP7XGvYu7Q58LdmtE8Z",
    "LITE": "XsexQ9qqNbDkLE6XwCN9ceVhLo8Lxc7UheVR6eBkKyo",
    "LLY": "Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH",
    "LMT": "XssULacY8D3z3a8HoQuLid8wdJHcZLGpSST9MkNFzox",
    "LRCX": "XsSN912SN4Whn2xn59vWZHt1uLbw9WnoNGp5MigmHFf",
    "MA": "XsApJFV9MAktqnAc6jqzsHVujxkGm9xcSUffaBoYLKC",
    "MARA": "XsguBZPkM9BDmxspmWe29EmrYZBv21ENcC27Pqh7grB",
    "MCD": "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2",
    "META": "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    "MP": "XsFARXCfXKCdu6BxV2WACBt3Dk88nxLujoqPzyyBib9",
    "MRK": "XsnQnU7AdbRZYe2akqqpibDdXjkieGFfSkbkjX1Sd1X",
    "MRNA": "XsViHjyRbiSBskjizb1gszGTmZqtAH8TuqwJ7sB5AcP",
    "MRVL": "XsuxRGDzbLjnJ72v74b7p9VY6N66uYgTCyfwwRjVCJA",
    "MSFT": "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
    "MSTR": "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
    "MU": "XsQLZycSZ7QnBBdBXQaTbQdiUcbRqjNJgyBGAMzhHav",
    "NBIS": "Xsii5eERa2sKFyTHQqdYxpxL5xoUSLVurzHeqBEMBho",
    "NET": "XsR3LAMkzuPP8DnfYaiB2grTWqkBVy286gjJVErK1bi",
    "NFLX": "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL",
    "NKE": "XsGYpMvKbVt6ViHqRd7cF3s746dAMFBQWcC49hB9VVP",
    "NOW": "XsBnEFd2EtpwBRNVfN8qLZcVUnuqXRaGCSEEFChLfxL",
    "NVDA": "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    "NVO": "XsfAzPzYrYjd4Dpa9BU3cusBsvWfVB9gBcyGC87S57n",
    "ON": "XsTzZxvfNdVESw8oEn7cNPnfQ4SGk7ncBSezfU6dxa7",
    "ONDS": "Xsgc9YTqdAH1GzDLBGQcScCMgkKsVBn4hBmqtNRospY",
    "ORCL": "XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL",
    "PALL": "XsTTtPA5V19YwHKDv4xeVXNM6kdsQNJvg3MyWkRUckt",
    "PEP": "Xsv99frTRUeornyvCfvhnDesQDWuvns1M852Pez91vF",
    "PFE": "XsAtbqkAP1HJxy7hFDeq7ok6yM43DQ9mQ1Rh861X8rw",
    "PG": "XsYdjDjNUygZ7yGKfQaB6TxLh2gC6RRjzLtLAGJrhzV",
    "PLTR": "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4",
    "PM": "Xsba6tUnSjDae2VcopDB6FGGDaxRrewFCDa5hKn5vT3",
    "PPLT": "Xst6eFD4YT6sz9RLMysN9SyvaZWtraSdVJQGu5ZkAme",
    "PYPL": "XshWQWYVp5ff8CrAEsGmLVKD47nBWi3Ygn5v8wXK27G",
    "QCOM": "XsUUG8bjFN2KvzLTpzavvEKdAjMAeLTZiTeAQJ9uhvB",
    "QQQ": "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    "RBLX": "Xss5RAku5EH6UViFdvW7ss9xQjwQLsrs2opPMhb3k43",
    "REGN": "XsWkTtvUXJgrvxvgGuHRRqk6iwDuviEQZw4uJFUUGgX",
    "RIOT": "Xs31mE5EiqjSHEaiX9QDKCN6NvSGCqpJ6f1FNq2wri5",
    "RKLB": "XsKSh3QDynp6oms9yHjZXbZo3pKzUBoqUFKPHS2g9Bh",
    "RRX": "XszxuQCqE72vU4ABTFDFwhs28AeSUHqzbWWVWDkhfYZ",
    "SBET": "XsEoih2x6nZuUjFwzGoba6MFmtzCkzW2c4YAm6baQbq",
    "SBUX": "Xs9gd8SGbYQn9kkUYQayn46BdqQbvvUshEF6ZpRAzM7",
    "SCHF": "XsWAnFM77x6YvpdaZoos79R12o4Yj4r7EVkaTWddzhU",
    "SGOV": "XsYD72ntjj7ZwoFDZCDmN2gamTcLpnywqvG7PQN5vCN",
    "SKHY": "XsnhgGRQwhExfS2bmWzR6EYddKGPRGDEjeJsatkmKqU",
    "SLV": "XsxAd6okt8y1RRK6gNg7iJaqiWNiq5Md5EDf3ZrF2dm",
    "SMCI": "XsMxAoJP47FQGLsVUvSS2QfBaHdNsd7DRU6nWRL8RSa",
    "SMH": "XstuBvLo7soZzj3beCCPonHpR3eUfPNSeQzw35Swons",
    "SNDK": "Xswbpc8UqU6e1j9QZEWCjBMjyvz4twqD7PCy6j2e7jj",
    "SNOW": "Xs3QCTNpPWTFYRQ9yPv9gsvWKNJGk45UQ1bb1w7xznc",
    "SNPS": "XsfGN1hFHbigfAzUY1nLRjrECm3ohGzVcim5pMqgp9d",
    "SOFI": "Xsipo31rLh5EqPMR2cArn6kVPAD83C6rxbmCrT9Wu5u",
    "SOLS": "XszuTk3Rr5HXpV7Nrfpg7KAZJfDccPAYLKBsRbLYRx4",
    "SOXL": "XsdZDkoMdUb6iKDAKKappuM7C1Q2HmTqC8jNujbfmCu",
    "SOXS": "XsCucuUESBi3ZjRxmjwUzGYuf6ZrtZDUvK6XhRA4RR3",
    "SOXX": "XsEsHeiNZf88sABxu74TPuXbQThdaQGdzPVZUBicjtQ",
    "SPCX": "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8",
    "SPY": "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    "STLD": "Xsw7mKDicsyZ7dgSMfFxhX5nbgat3uG9V1nCxDy6Gvp",
    "STRC": "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH",
    "TBLL": "XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp",
    "TER": "Xsbe4fwmjVQEWEPkzfyxqNdPUUK7X9dKfTJrZdDbNgx",
    "TMO": "Xs8drBWy3Sd5QY3aifG9kt9KFs2K3PGZmx7jWrsrk57",
    "TMUS": "XswCi2U1G6Ppbw1QhG45yKb8UKuR1FKLJrquv2FZSD4",
    "TQQQ": "XsjQP3iMAaQ3kQScQKthQpx9ALRbjKAjQtHg6TFomoc",
    "TSLA": "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    "TSM": "XsafvsGtzFqqHgTnA3aPC83EAMkacU5mcGtcSayhpVV",
    "TTWO": "XssvmC28hqLgtT5kf8R8eAv3mejy4XftJ6MXB8QywTa",
    "UBER": "XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB",
    "UNH": "XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe",
    "URA": "Xsq9sEQjYiUTSZ55RrbHAzVfz8HotwFGrqgxkgiv4LB",
    "USAR": "XsJJneENiaBPqqcdK1gMsfwi9cbw111azigzRYHoctX",
    "V": "XsqgsbXwWogGJsNcVZ3TyVouy2MbTkfCFhCGGGcQZ2p",
    "VIDA": "XsfCC9VL4DamVGNgdJpfLXB3sBVa158Gbx8sh7NzmTk",
    "VRT": "XsLUiVEwYeoneKpgR1C2Q4DBUZhX4xDktSCfQqq8zmn",
    "VRTX": "XsgCWpLUC3pv6JmNAFtkYmuwSaikShy8QZRuripgBzn",
    "VT": "XsEdDDTcVGJU6nvdRdVnj53eKTrsCkvtrVfXGmUK68V",
    "VTI": "XsssYEQjzxBCFgvYFFNuhJFBeHNdLWYeUSP8F45cDr9",
    "VUG": "XsNVBwVGqtDqmA2Waoiux5mfykH8nepLK74z3ZoQWK2",
    "WDC": "XsmopJuh6C6uNFJa3KaVoYqEtrf3Y7M5LYwRLKLER3h",
    "WMT": "Xs151QeqTCiuKtinzfRATnUESM2xTU6V9Wy8Vy538ci",
    "XEL": "Xsr6MgLKmoEmN4aL78MQ2q98R8wJnZ3FaCZUMwkNbNU",
    "XLE": "Xs54CrhmpVp6uxZXwgSTegrRH2kShh88XFPzgf4BExu",
    "XOM": "XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh",
    "XOP": "XsAk6BoV4kBXUM6WXodKyM21CN92G9jArwAzFvbh3LX",
    "ZM": "XsgDPEr2Zk1YkWnw1Mm77APoZpeTj8BQZeGSMVtBZGd",
};

// CoinGecko ids for 24/7 tokenized metals. GC=F/SI=F are the Yahoo futures
// symbols the engine assigns to gold/silver legs (see prices.mjs Y_METAL).
const CG_TOKEN = {
    "GC=F": "pax-gold",
    "SI=F": "kinesis-silver",
    XAUT: "tether-gold",
    PAXG: "pax-gold",
};

export const TOKEN_SRC = {};
for (const [k, id] of Object.entries(JUP_MINT)) TOKEN_SRC[k] = {source: "jupiter", id};
for (const [k, id] of Object.entries(CG_TOKEN)) TOKEN_SRC[k] = {source: "coingecko", id};

// Issuer-tagged matrix variants (WAAPL, RMSTR, NVDAB, ...) reduce to a covered
// underlying: exact key first, then strip one known prefix/suffix when the
// remainder is covered. Wrong reductions are caught by the compare band.
const PREFIXES = ["WB", "R", "S", "W", "A"];
const SUFFIXES = ["RH", "B", "C", "R"];
export function tokenSourceFor(sym) {
    if (TOKEN_SRC[sym]) return TOKEN_SRC[sym];
    for (const p of PREFIXES) {
        const rest = sym.startsWith(p) ? sym.slice(p.length) : null;
        if (rest && TOKEN_SRC[rest]?.source === "jupiter") return TOKEN_SRC[rest];
    }
    for (const s of SUFFIXES) {
        const rest = sym.endsWith(s) ? sym.slice(0, -s.length) : null;
        if (rest && TOKEN_SRC[rest]?.source === "jupiter") return TOKEN_SRC[rest];
    }
    return null;
}

const JUP_URL = "https://lite-api.jup.ag/price/v3?ids=";
const CG_URL = "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_last_updated_at=true&ids=";
const chunk = (a, n) => Array.from({length: Math.ceil(a.length / n)}, (_, i) => a.slice(i * n, i * n + n));

// Batch-fetch 24/7 token prices for engine symbols. Returns {SYM: {price,
// source, ts}} for covered symbols that came back positive; the rest omitted.
export async function getTokenPrices(symbols) {
    const bySym = {};
    for (const s of new Set(symbols)) {
        const src = tokenSourceFor(s);
        if (src) bySym[s] = src;
    }
    const out = {};
    const jup = Object.entries(bySym).filter(([, v]) => v.source === "jupiter");
    const cg = Object.entries(bySym).filter(([, v]) => v.source === "coingecko");
    const tasks = [];
    for (const batch of chunk(jup, 50)) {
        tasks.push((async () => {
            const r = await fetch(JUP_URL + batch.map(([, v]) => v.id).join(","));
            if (!r.ok) return;
            const j = await r.json();
            const ts = Date.now();
            for (const [sym, v] of batch) {
                const p = Number(j[v.id]?.usdPrice);
                if (p > 0) out[sym] = {price: p, source: "jupiter", ts};
            }
        })().catch(() => {}));
    }
    if (cg.length) {
        tasks.push((async () => {
            const ids = [...new Set(cg.map(([, v]) => v.id))];
            const r = await fetch(CG_URL + ids.join(","));
            if (!r.ok) return;
            const j = await r.json();
            for (const [sym, v] of cg) {
                const row = j[v.id];
                const p = Number(row?.usd);
                if (p > 0) out[sym] = {price: p, source: "coingecko", ts: (row.last_updated_at ?? 0) * 1000 || Date.now()};
            }
        })().catch(() => {}));
    }
    await Promise.all(tasks);
    return out;
}
