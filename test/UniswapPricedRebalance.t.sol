// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockUniswapV3Pool} from "../src/MockUniswapV3Pool.sol";
import {StableIndexVault} from "../src/StableIndexVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Tok is ERC20 {
    uint8 private d;

    constructor(string memory n, uint8 _d) ERC20(n, n) {
        d = _d;
    }

    function decimals() public view override returns (uint8) {
        return d;
    }
}

// Proves the vault can rebalance on prices sourced from Uniswap V3 pools: seed
// one pool per asset, read each pool's slot0 back to a USD price on-chain, then
// feed those exact prices into the signed rebalance path. The vault interface
// is unchanged; only the price origin differs.
contract UniswapPricedRebalanceTest is Test {
    MockUSDC usdc;
    StableIndexVault vault;
    MockUniswapV3Pool[3] pools;
    Tok[3] assets;

    uint256 rebalPk = 0xBEEF;
    address rebalancer;
    address depositor = makeAddr("depositor");

    uint256 constant N = 3;
    uint256 constant DEPOSIT = 1000e6;

    // Target USD prices (1e18) for BTC/ETH/SOL-like assets.
    uint256[N] targets = [uint256(76769e18), 2384e18, 99e18];

    function setUp() public {
        rebalancer = vm.addr(rebalPk);
        usdc = new MockUSDC();
        vault = new StableIndexVault(rebalancer, address(usdc), N);

        for (uint256 i; i < N; i++) {
            assets[i] = new Tok("A", 18);
            pools[i] = new MockUniswapV3Pool(
                address(assets[i]), address(usdc), 18, 6, 3000
            );
            pools[i].seedPriceUsdE18(targets[i]);
        }

        usdc.mint(depositor, DEPOSIT);
        vm.startPrank(depositor);
        usdc.approve(address(vault), DEPOSIT);
        vault.deposit(DEPOSIT);
        vm.stopPrank();
    }

    // Read a pool's slot0 back to a USD price (1e18), mirroring the JS reader.
    // Both branches stage the 2**96 shifts through divisions by sqrtPriceX96 to
    // keep every intermediate inside uint256.
    function _readUsdE18(MockUniswapV3Pool pool)
        internal
        view
        returns (uint256)
    {
        (uint160 sp,,,,,,) = pool.slot0();
        uint256 ratioX192 = uint256(sp) * uint256(sp);
        uint8 ad = pool.assetDecimals();
        uint8 sd = pool.stableDecimals();
        if (pool.assetIsToken0()) {
            // usdE18 = ratioX192/2**192 * 10^ad/10^sd * 1e18
            uint256 a = ratioX192 >> 96;
            return (a * (10 ** ad) * 1e18) / (10 ** sd) >> 96;
        } else {
            // usdE18 = (1e18 * 10^ad/10^sd) * 2**192 / ratioX192, staged as two
            // (<<96)/sp steps so nothing overflows.
            uint256 t1 = (1e18 * (10 ** ad)) / (10 ** sd);
            uint256 t2 = (t1 << 96) / uint256(sp);
            return (t2 << 96) / uint256(sp);
        }
    }

    function _sign(uint16[] memory w, uint256[] memory p)
        internal
        view
        returns (bytes memory)
    {
        bytes32 h = keccak256(abi.encode(address(vault), vault.nonce(), w, p));
        bytes32 eth =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(rebalPk, eth);
        return abi.encodePacked(r, s, v);
    }

    function test_rebalanceOnPoolPrices() public {
        uint256[] memory p = new uint256[](N);
        for (uint256 i; i < N; i++) {
            p[i] = _readUsdE18(pools[i]);
            assertApproxEqRel(p[i], targets[i], 1e15); // pool price ~= target
        }
        uint16[] memory w = new uint16[](N);
        w[0] = 5000;
        w[1] = 3000;
        w[2] = 2000;

        vault.rebalance(w, p, _sign(w, p));

        uint256 nav = DEPOSIT * 1e12;
        uint256[] memory hold = vault.getHoldings();
        uint256 sum;
        for (uint256 i; i < N; i++) {
            sum += (hold[i] * p[i]) / 1e18;
        }
        assertApproxEqAbs(sum, nav, 1e12); // priced back to nav on pool prices
        assertEq(vault.nonce(), 1);
    }
}
