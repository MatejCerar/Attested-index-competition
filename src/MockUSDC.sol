// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Minimal 6-decimals USD stablecoin for the demo. Public mint + faucet, so
/// anyone can mint test USD 1:1 (1e6 = 1.0 USD). Testnet only.
contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1000e6; // 1000 test USD

    event Faucet(address indexed to, uint256 amount);

    constructor() ERC20("Mock USD Coin", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// Mint any amount of test USD to `to`. Open by design for the demo.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// Mint a fixed 1000 test USD to the caller.
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
        emit Faucet(msg.sender, FAUCET_AMOUNT);
    }
}
