// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC usdc;
    address alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockUSDC();
    }

    function test_decimalsIs6() public view {
        assertEq(usdc.decimals(), 6);
    }

    function test_mintTo() public {
        usdc.mint(alice, 500e6);
        assertEq(usdc.balanceOf(alice), 500e6);
    }

    // faucet() mints a fixed 1000 test USD (1:1) to the caller.
    function test_faucetMints1000ToCaller() public {
        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), 1000e6);
        assertEq(usdc.FAUCET_AMOUNT(), 1000e6);
    }

    function test_faucetIsRepeatable() public {
        vm.startPrank(alice);
        usdc.faucet();
        usdc.faucet();
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 2000e6);
    }
}
