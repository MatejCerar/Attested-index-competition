// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {StableIndexVault} from "../src/StableIndexVault.sol";

contract StableIndexVaultTest is Test {
    MockUSDC usdc;
    StableIndexVault vault;

    uint256 rebalPk = 0xBEEF;
    address rebalancer;
    address depositor = makeAddr("depositor");

    uint256 constant N = 3;
    uint256 constant DEPOSIT = 1000e6; // 1000 mUSDC (6 decimals)

    function setUp() public {
        rebalancer = vm.addr(rebalPk);
        usdc = new MockUSDC();
        vault = new StableIndexVault(rebalancer, address(usdc), N);

        usdc.mint(depositor, DEPOSIT);
        vm.startPrank(depositor);
        usdc.approve(address(vault), DEPOSIT);
        vault.deposit(DEPOSIT);
        vm.stopPrank();
    }

    function _prices() internal pure returns (uint256[] memory p) {
        p = new uint256[](N);
        p[0] = 60000e18; // BTC
        p[1] = 3000e18; // ETH
        p[2] = 150e18; // SOL
    }

    function _weights() internal pure returns (uint16[] memory w) {
        w = new uint16[](N);
        w[0] = 5000;
        w[1] = 3000;
        w[2] = 2000;
    }

    function _sign(uint256 pk, uint16[] memory w, uint256[] memory p)
        internal
        view
        returns (bytes memory)
    {
        bytes32 h = keccak256(abi.encode(address(vault), vault.nonce(), w, p));
        bytes32 eth =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, eth);
        return abi.encodePacked(r, s, v);
    }

    function test_depositUpdatesCash() public {
        assertEq(vault.cash(), DEPOSIT);
        assertEq(vault.totalDeposited(), DEPOSIT);
        assertEq(usdc.balanceOf(address(vault)), DEPOSIT);
    }

    function test_rebalanceSetsHoldingsAndNav() public {
        uint16[] memory w = _weights();
        uint256[] memory p = _prices();
        bytes memory sig = _sign(rebalPk, w, p);

        vm.recordLogs();
        vault.rebalance(w, p, sig);

        // nav is deposit scaled to 1e18: 1000e6 * 1e12 = 1000e18
        uint256 nav = DEPOSIT * 1e12;
        uint256[] memory hold = vault.getHoldings();
        uint256 sum;
        for (uint256 i; i < N; i++) {
            uint256 target = (nav * w[i]) / 10000;
            assertEq(hold[i], (target * 1e18) / p[i]);
            sum += (hold[i] * p[i]) / 1e18;
        }
        // holdings priced back to nav within rounding dust
        assertApproxEqAbs(sum, nav, 1e6);
        assertEq(vault.cash(), 0);
        assertEq(vault.nonce(), 1);
    }

    function test_badSigReverts() public {
        uint16[] memory w = _weights();
        uint256[] memory p = _prices();
        bytes memory sig = _sign(0xBAD, w, p); // wrong signer
        vm.expectRevert(StableIndexVault.BadSig.selector);
        vault.rebalance(w, p, sig);
    }

    function test_badWeightsReverts() public {
        uint16[] memory w = _weights();
        w[0] = 4000; // sum now 9000, not 10000
        uint256[] memory p = _prices();
        bytes memory sig = _sign(rebalPk, w, p);
        vm.expectRevert(StableIndexVault.BadWeights.selector);
        vault.rebalance(w, p, sig);
    }

    function test_badLenReverts() public {
        uint16[] memory w = new uint16[](2);
        w[0] = 5000;
        w[1] = 5000;
        uint256[] memory p = _prices();
        bytes memory sig = _sign(rebalPk, w, p);
        vm.expectRevert(StableIndexVault.BadLen.selector);
        vault.rebalance(w, p, sig);
    }
}
