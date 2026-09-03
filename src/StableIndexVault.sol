// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IERC20Metadata
} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// A stablecoin-denominated index vault. Deposits are pulled in a USD stable
/// (cash valued at 1.0 USD) and the vault tracks a synthetic portfolio.
/// rebalance() moves holdings to the target weights and is gated by an FCC
/// signature over (vault, nonce, weightsBps, pricesE18): the rebalancer reads
/// prices off-chain and signs weights + prices, so the allocation is
/// autonomous and attested, and the rebalance is a real on-chain state change.
contract StableIndexVault {
    using SafeERC20 for IERC20;

    address public immutable rebalancer; // FCC enclave signer
    IERC20 public immutable stable; // USD stablecoin, cash = 1.0 USD
    uint256 public immutable n; // number of index assets
    uint256 public immutable stableTo1e18; // scale stable decimals up to 1e18

    uint256[] public holdings; // 1e18 synthetic units per asset
    uint256 public cash; // undeployed stablecoin backing, stable decimals
    uint256 public totalDeposited; // cumulative deposits, stable decimals
    uint256 public nonce;

    event Deposited(address indexed from, uint256 amount);
    event Rebalanced(
        uint256 nonce,
        uint16[] weightsBps,
        uint256[] holdings,
        uint256 navUsd1e18
    );

    error BadSig();
    error BadLen();
    error BadWeights();
    error Empty();

    constructor(address _rebalancer, address _stable, uint256 _n) {
        rebalancer = _rebalancer;
        stable = IERC20(_stable);
        n = _n;
        holdings = new uint256[](_n);
        uint8 dec = IERC20Metadata(_stable).decimals();
        stableTo1e18 = 10 ** (18 - dec);
    }

    function getHoldings() external view returns (uint256[] memory) {
        return holdings;
    }

    /// Pull `amount` of the stablecoin into the vault as cash.
    function deposit(uint256 amount) external {
        stable.safeTransferFrom(msg.sender, address(this), amount);
        cash += amount;
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    /// Rebalance to weightsBps using FCC-signed USD prices (all 1e18).
    /// Cash is USD (1.0), so no separate cash price is signed.
    function rebalance(
        uint16[] calldata weightsBps,
        uint256[] calldata pricesE18,
        bytes calldata sig
    ) external {
        if (weightsBps.length != n || pricesE18.length != n) revert BadLen();
        bytes32 h = keccak256(
            abi.encode(address(this), nonce, weightsBps, pricesE18)
        );
        if (ECDSA.recover(ECDSA.toEthSignedMessageHash(h), sig) != rebalancer) {
            revert BadSig();
        }
        nonce++;

        uint256 nav = cash * stableTo1e18;
        for (uint256 i; i < n; i++) {
            nav += (holdings[i] * pricesE18[i]) / 1e18;
        }
        if (nav == 0) revert Empty();

        uint256 sumW;
        for (uint256 i; i < n; i++) {
            uint256 target = (nav * weightsBps[i]) / 10000;
            holdings[i] = (target * 1e18) / pricesE18[i];
            sumW += weightsBps[i];
        }
        if (sumW != 10000) revert BadWeights();
        cash = 0;
        emit Rebalanced(nonce, weightsBps, holdings, nav);
    }
}
