// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IndexShareVault} from "./IndexShareVault.sol";

/// Deploys one IndexShareVault per index. Every vault shares the same FCC
/// rebalancer signer and stablecoin, so the deployer only passes the per-index
/// price-pool list. The server calls createVault when a user submits an index;
/// the five house indices are created the same way at setup.
contract VaultFactory {
    address public immutable rebalancer; // FCC enclave signer
    address public immutable stable; // USD stablecoin
    address[] public vaults; // every vault this factory has created

    event VaultCreated(
        address indexed vault,
        address[] pools,
        uint256 index
    );

    constructor(address _rebalancer, address _stable) {
        rebalancer = _rebalancer;
        stable = _stable;
    }

    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }

    /// Deploy a vault for an index over `pools` (one price pool per asset).
    function createVault(address[] calldata pools) external returns (address) {
        IndexShareVault v = new IndexShareVault(rebalancer, stable, pools);
        vaults.push(address(v));
        emit VaultCreated(address(v), pools, vaults.length - 1);
        return address(v);
    }
}
