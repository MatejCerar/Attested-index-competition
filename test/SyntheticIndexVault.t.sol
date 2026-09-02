// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {SyntheticIndexVault} from "../src/SyntheticIndexVault.sol";

contract SyntheticIndexVaultTest is Test {
    SyntheticIndexVault vault;
    uint256 pk = 0xA11CE;
    address rebalancer;

    function setUp() public {
        rebalancer = vm.addr(pk);
        vault = new SyntheticIndexVault(rebalancer, 2);
        vault.deposit{value: 100 ether}();
    }

    function _sign(uint16[] memory w, uint256[] memory p, uint256 flrUsd)
        internal
        view
        returns (bytes memory)
    {
        bytes32 h =
            keccak256(abi.encode(address(vault), vault.nonce(), w, p, flrUsd));
        bytes32 eth =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, eth);
        return abi.encodePacked(r, s, v);
    }

    function test_rebalanceMovesHoldings() public {
        uint16[] memory w = new uint16[](2);
        w[0] = 6000;
        w[1] = 4000;
        uint256[] memory p = new uint256[](2);
        p[0] = 60000e18; // BTC-ish
        p[1] = 2500e18; // ETH-ish
        uint256 flrUsd = 0.0066e18;

        vault.rebalance(w, p, flrUsd, _sign(w, p, flrUsd));

        assertEq(vault.nonce(), 1);
        uint256[] memory h = vault.getHoldings();
        // both legs funded, and value split ~60/40
        assertGt(h[0], 0);
        assertGt(h[1], 0);
        uint256 v0 = (h[0] * p[0]) / 1e18;
        uint256 v1 = (h[1] * p[1]) / 1e18;
        assertApproxEqRel(v0, (v0 + v1) * 6000 / 10000, 1e15); // ~60%
    }

    function test_badSignerReverts() public {
        uint16[] memory w = new uint16[](2);
        w[0] = 5000;
        w[1] = 5000;
        uint256[] memory p = new uint256[](2);
        p[0] = 1e18;
        p[1] = 1e18;
        // sign with a different key
        bytes32 h = keccak256(
            abi.encode(address(vault), vault.nonce(), w, p, uint256(1e18))
        );
        bytes32 eth =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, eth);
        vm.expectRevert(SyntheticIndexVault.BadSig.selector);
        vault.rebalance(w, p, 1e18, abi.encodePacked(r, s, v));
    }

    function test_weightsMustSumTo100() public {
        uint16[] memory w = new uint16[](2);
        w[0] = 6000;
        w[1] = 3000; // sums to 9000
        uint256[] memory p = new uint256[](2);
        p[0] = 1e18;
        p[1] = 1e18;
        uint256 flrUsd = 1e18;
        bytes memory sig = _sign(w, p, flrUsd);
        vm.expectRevert(SyntheticIndexVault.BadWeights.selector);
        vault.rebalance(w, p, flrUsd, sig);
    }
}
