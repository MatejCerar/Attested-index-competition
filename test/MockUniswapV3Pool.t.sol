// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockUniswapV3Pool} from "../src/MockUniswapV3Pool.sol";

// A second 18-decimals token so we exercise both pair orderings (asset as
// token0 and asset as token1 depend on address sort).
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockAsset is ERC20 {
    constructor() ERC20("Mock Asset", "mAST") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockUniswapV3PoolTest is Test {
    MockUSDC usdc;
    MockAsset asset;

    function setUp() public {
        usdc = new MockUSDC();
        asset = new MockAsset();
    }

    // Recover the USD price a reader would compute from slot0, mirroring the
    // off-chain reader: price = (sqrtPriceX96/2**96)**2 with decimals applied.
    function _readUsdE18(MockUniswapV3Pool pool)
        internal
        view
        returns (uint256)
    {
        (uint160 sp,,,,,,) = pool.slot0();
        // ratioX192 = sqrtPriceX96**2 = price(token1/token0) * 2**192
        uint256 ratioX192 = uint256(sp) * uint256(sp);
        bool assetIsToken0 = pool.assetIsToken0();
        uint8 ad = pool.assetDecimals();
        uint8 sd = pool.stableDecimals();
        // Stage the 2**192 divide as two 2**96 shifts to stay in 256 bits.
        if (assetIsToken0) {
            // usdE18 = ratioX192/2**192 * 10^ad/10^sd * 1e18
            uint256 a = ratioX192 >> 96; // /2**96
            return (a * (10 ** ad) * 1e18) / (10 ** sd) >> 96;
        } else {
            // usdE18 = (1e18 * 10^ad/10^sd) * 2**192 / ratioX192, staged.
            uint256 t1 = (1e18 * (10 ** ad)) / (10 ** sd);
            uint256 t2 = (t1 << 96) / uint256(sp);
            return (t2 << 96) / uint256(sp);
        }
    }

    function _pool(uint256 priceUsdE18) internal returns (MockUniswapV3Pool p) {
        p = new MockUniswapV3Pool(address(asset), address(usdc), 18, 6, 3000);
        p.seedPriceUsdE18(priceUsdE18);
    }

    function test_readsSeededPriceBTC() public {
        MockUniswapV3Pool p = _pool(76769e18); // ~BTC
        uint256 got = _readUsdE18(p);
        assertApproxEqRel(got, 76769e18, 1e15); // within 0.1%
    }

    function test_readsSeededPriceSmall() public {
        MockUniswapV3Pool p = _pool(657099e12); // 0.00657099, ~FLR
        uint256 got = _readUsdE18(p);
        assertApproxEqRel(got, 657099e12, 1e15);
    }

    function test_tokenOrderingSorted() public {
        MockUniswapV3Pool p = _pool(100e18);
        assertTrue(p.token0() < p.token1());
        address a = address(asset);
        address s = address(usdc);
        assertEq(p.assetIsToken0(), a < s);
    }

    function test_observeIsConstantTwap() public {
        MockUniswapV3Pool p = _pool(100e18);
        uint32[] memory ago = new uint32[](2);
        ago[0] = 1800; // 30m ago
        ago[1] = 0; // now
        (int56[] memory tc,) = p.observe(ago);
        int56 twapTick = (tc[0] - tc[1]) / int56(uint56(1800));
        assertEq(int256(twapTick), int256(p.tick()));
    }

    function test_reseedUpdatesPrice() public {
        MockUniswapV3Pool p = _pool(100e18);
        p.seedPriceUsdE18(250e18);
        assertApproxEqRel(_readUsdE18(p), 250e18, 1e15);
    }

    // Owner-only live setter: set -> slot0 read round-trips to the set price.
    function test_setPriceRoundTrips() public {
        MockUniswapV3Pool p = _pool(100e18);
        p.setPriceE18(76769e18);
        assertApproxEqRel(_readUsdE18(p), 76769e18, 1e15);
        p.setPriceE18(657099e12);
        assertApproxEqRel(_readUsdE18(p), 657099e12, 1e15);
    }

    function test_setPriceOnlyOwner() public {
        MockUniswapV3Pool p = _pool(100e18);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert("not owner");
        p.setPriceE18(200e18);
    }
}
