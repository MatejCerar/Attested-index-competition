// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// A synthetic index vault. It holds the native C2FLR deposit and tracks a
/// USD-valued portfolio. rebalance() moves the vault's holdings to the target
/// weights and is gated by an FCC signature over (vault, nonce, weights,
/// prices): the FCC rebalancer reads FTSO off-chain and signs the prices +
/// weights, so the allocation is autonomous and attested, and the rebalance
/// is a real on-chain state change. Holdings are synthetic (priced by the
/// signed FTSO values); on Hyperliquid the same step becomes real orders.
contract SyntheticIndexVault {
    address public immutable rebalancer; // FCC enclave signer
    uint256 public immutable n; // number of index assets
    uint256[] public holdings; // 1e18 units per asset
    uint256 public cashWei; // undeployed native backing
    uint256 public totalDepositWei;
    uint256 public nonce;

    event Deposited(address indexed from, uint256 weiAmount);
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

    constructor(address _rebalancer, uint256 _n) {
        rebalancer = _rebalancer;
        n = _n;
        holdings = new uint256[](_n);
    }

    function getHoldings() external view returns (uint256[] memory) {
        return holdings;
    }

    function deposit() external payable {
        cashWei += msg.value;
        totalDepositWei += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// Rebalance to weightsBps using FCC-signed FTSO prices (all 1e18).
    /// pricesE18[i] is the USD price of asset i; flrUsd1e18 prices the cash.
    function rebalance(
        uint16[] calldata weightsBps,
        uint256[] calldata pricesE18,
        uint256 flrUsd1e18,
        bytes calldata sig
    ) external {
        if (weightsBps.length != n || pricesE18.length != n) {
            revert BadLen();
        }
        bytes32 h = keccak256(
            abi.encode(address(this), nonce, weightsBps, pricesE18, flrUsd1e18)
        );
        if (ECDSA.recover(ECDSA.toEthSignedMessageHash(h), sig) != rebalancer) {
            revert BadSig();
        }
        nonce++;

        uint256 nav = (cashWei * flrUsd1e18) / 1e18;
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
        cashWei = 0;
        emit Rebalanced(nonce, weightsBps, holdings, nav);
    }
}
