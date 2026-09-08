// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// A minimal Uniswap V3 pool mock: enough of the real interface that a standard
/// V3 price reader works unchanged. One pool per index asset, paired against
/// the mock USD stablecoin. slot0() returns a sqrtPriceX96 seeded to a target
/// USD price; token0()/token1() give the pair ordering the reader needs to
/// interpret that price; observe() returns constant cumulative ticks so a TWAP
/// over any window resolves to the seeded price. Prices are set by the deploy /
/// seed script; on mainnet the same reader points at real SparkDEX pools with
/// no code change.
///
/// Uniswap V3 defines price(token1 per token0) = (sqrtPriceX96 / 2**96)**2,
/// in raw token units. This mock inverts that: given a USD price it computes
/// the matching sqrtPriceX96 so a reader recovers the same price back out.
contract MockUniswapV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;

    address public immutable stable; // quote side, valued 1.0 USD
    uint8 public immutable assetDecimals;
    uint8 public immutable stableDecimals;
    bool public immutable assetIsToken0;

    uint160 public sqrtPriceX96; // current pool price, Q64.96
    int24 public tick;
    uint256 public priceUsdE18; // last set USD price, 1e18 (direct read for NAV)
    address public owner; // may push live prices; set to the deployer

    event PriceSeeded(uint256 priceUsdE18, uint160 sqrtPriceX96);
    event PriceUpdated(uint256 priceUsdE18, uint160 sqrtPriceX96);

    constructor(
        address _asset,
        address _stable,
        uint8 _assetDecimals,
        uint8 _stableDecimals,
        uint24 _fee
    ) {
        stable = _stable;
        assetDecimals = _assetDecimals;
        stableDecimals = _stableDecimals;
        fee = _fee;
        owner = msg.sender;
        assetIsToken0 = _asset < _stable;
        (token0, token1) = assetIsToken0 ? (_asset, _stable) : (_stable, _asset);
    }

    /// Seed the pool to a target asset price in USD (1e18-scaled). Open, so the
    /// seed script and tests can initialize without an owner check.
    function seedPriceUsdE18(uint256 _priceUsdE18) external {
        uint160 sp = _writePrice(_priceUsdE18);
        emit PriceSeeded(_priceUsdE18, sp);
    }

    /// Owner-only live price setter: the keeper pushes each tick's price here.
    /// Same math as the seed path; the slot0/observe read path is unchanged.
    function setPriceE18(uint256 _priceUsdE18) external {
        require(msg.sender == owner, "not owner");
        uint160 sp = _writePrice(_priceUsdE18);
        emit PriceUpdated(_priceUsdE18, sp);
    }

    // Convert a USD price to sqrtPriceX96, store it and the tick.
    function _writePrice(uint256 _priceUsdE18) internal returns (uint160 sp) {
        require(_priceUsdE18 > 0, "price=0");
        sp = sqrtPriceX96For(
            _priceUsdE18, assetIsToken0, assetDecimals, stableDecimals
        );
        sqrtPriceX96 = sp;
        priceUsdE18 = _priceUsdE18; // direct value for on-chain NAV reads
        tick = int24(int256(uint256(sp) >> 96)); // coarse tick; readers use slot0
    }

    function slot0()
        external
        view
        returns (
            uint160 _sqrtPriceX96,
            int24 _tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        )
    {
        return (sqrtPriceX96, tick, 0, 1, 1, 0, true);
    }

    /// Constant-observation TWAP: cumulative tick grows linearly with time, so
    /// (tickCumulatives[0] - tickCumulatives[1]) / window == the seeded tick.
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (
            int56[] memory tickCumulatives,
            uint160[] memory secondsPerLiquidityCumulativeX128s
        )
    {
        uint256 len = secondsAgos.length;
        tickCumulatives = new int56[](len);
        secondsPerLiquidityCumulativeX128s = new uint160[](len);
        for (uint256 i; i < len; i++) {
            tickCumulatives[i] = int56(tick) * int56(uint56(secondsAgos[i]));
        }
    }

    /// Pure helper (also handy in tests): USD price -> sqrtPriceX96.
    /// ratio = price(token1/token0) in raw units. When the asset is token0 and
    /// the stable is token1, ratio = priceUsd * 10^stableDec / 10^assetDec.
    /// When inverted, ratio = (1/priceUsd) * 10^assetDec / 10^stableDec.
    /// sqrtPriceX96 = sqrt(ratio) * 2**96, computed as
    /// sqrt(ratio * 2**192) with a 256-bit-safe split of the shift.
    function sqrtPriceX96For(
        uint256 _priceUsdE18,
        bool _assetIsToken0,
        uint8 _assetDecimals,
        uint8 _stableDecimals
    ) public pure returns (uint160) {
        // Represent ratio as num/den in raw token units.
        uint256 num;
        uint256 den;
        if (_assetIsToken0) {
            num = _priceUsdE18 * (10 ** _stableDecimals);
            den = 1e18 * (10 ** _assetDecimals);
        } else {
            num = 1e18 * (10 ** _assetDecimals);
            den = _priceUsdE18 * (10 ** _stableDecimals);
        }
        // sqrt(num/den) * 2**96 = sqrt(num * 2**192 / den). Shift by 2**96
        // twice, sqrt-ing after the first shift to stay inside 256 bits.
        uint256 r = _sqrt((num << 96) / den); // sqrt(num/den) * 2**48
        return uint160(r << 48); // * 2**48 -> total 2**96
    }

    // Babylonian integer sqrt.
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
