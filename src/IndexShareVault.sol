// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IERC20Metadata
} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// Minimal price source: each asset's MockUniswapV3Pool exposes its USD price.
interface IPricePool {
    function priceUsdE18() external view returns (uint256);
}

/// A stablecoin-denominated index vault with ERC-20 SHARES. Deposits pull the
/// stable and mint shares priced by live NAV; NAV is read on-chain as
/// cash + sum(holdings[i] * poolPrice[i]), where each price comes from that
/// asset's pool. rebalance() is FCC-signed over (vault, nonce, weights, prices)
/// exactly as before, so allocation stays autonomous and attested. Holdings are
/// synthetic (no real swaps): the stable stays in the vault as backing, so a
/// redemption pays a share of NAV capped by the real stable balance.
contract IndexShareVault is ERC20 {
    using SafeERC20 for IERC20;

    address public immutable rebalancer; // FCC enclave signer
    IERC20 public immutable stable; // USD stablecoin, cash = 1.0 USD
    uint256 public immutable n; // number of index assets
    uint256 public immutable stableTo1e18; // scale stable decimals up to 1e18

    address[] public pools; // one price pool per asset, index-aligned
    uint256[] public holdings; // 1e18 synthetic units per asset
    uint256 public cash; // undeployed stablecoin backing, stable decimals
    uint256 public totalDeposited; // cumulative gross deposits, stable decimals
    uint256 public nonce;

    event Deposited(address indexed from, uint256 assets, uint256 shares);
    event Withdrawn(address indexed to, uint256 assets, uint256 shares);
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
    error ZeroShares();

    constructor(address _rebalancer, address _stable, address[] memory _pools)
        ERC20("Attested Index Share", "AIDX")
    {
        rebalancer = _rebalancer;
        stable = IERC20(_stable);
        n = _pools.length;
        pools = _pools;
        holdings = new uint256[](_pools.length);
        uint8 dec = IERC20Metadata(_stable).decimals();
        stableTo1e18 = 10 ** (18 - dec);
    }

    function getHoldings() external view returns (uint256[] memory) {
        return holdings;
    }

    function getPools() external view returns (address[] memory) {
        return pools;
    }

    /// Portfolio value in 1e18 USD: idle cash plus synthetic holdings valued at
    /// each asset's live on-chain pool price.
    function navUsdE18() public view returns (uint256 nav) {
        nav = cash * stableTo1e18;
        for (uint256 i; i < n; i++) {
            uint256 p = IPricePool(pools[i]).priceUsdE18();
            nav += (holdings[i] * p) / 1e18;
        }
    }

    /// NAV in stable units, for share pricing.
    function totalAssets() public view returns (uint256) {
        return navUsdE18() / stableTo1e18;
    }

    /// Deposit `amount` of the stablecoin, mint shares priced by current NAV.
    function deposit(uint256 amount) external returns (uint256 shares) {
        if (amount == 0) revert ZeroShares();
        uint256 ts = totalSupply();
        uint256 ta = totalAssets(); // value BEFORE this deposit lands
        stable.safeTransferFrom(msg.sender, address(this), amount);
        cash += amount;
        totalDeposited += amount;
        if (ts == 0 || ta == 0) {
            shares = amount * stableTo1e18; // 1 USD == 1e18 shares on first mint
        } else {
            shares = (amount * ts) / ta;
        }
        if (shares == 0) revert ZeroShares();
        _mint(msg.sender, shares);
        emit Deposited(msg.sender, amount, shares);
    }

    /// Redeem `shares` for a proportional slice of NAV, paid in the stablecoin.
    /// Holdings and cash are marked down pro-rata. Because holdings are synthetic
    /// (unbacked gains), the payout is capped by the real stable balance.
    function redeem(uint256 shares) external returns (uint256 amount) {
        uint256 ts = totalSupply();
        if (shares == 0 || shares > balanceOf(msg.sender)) revert ZeroShares();
        amount = (totalAssets() * shares) / ts;
        uint256 bal = stable.balanceOf(address(this));
        if (amount > bal) amount = bal;
        uint256 rem = ts - shares;
        for (uint256 i; i < n; i++) {
            holdings[i] = (holdings[i] * rem) / ts;
        }
        cash = rem == 0 ? 0 : (cash * rem) / ts;
        _burn(msg.sender, shares);
        stable.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, shares);
    }

    /// Rebalance to weightsBps using FCC-signed USD prices (all 1e18).
    /// Cash is USD (1.0), so no separate cash price is signed.
    function rebalance(
        uint16[] calldata weightsBps,
        uint256[] calldata pricesE18,
        bytes calldata sig
    ) external {
        if (weightsBps.length != n || pricesE18.length != n) revert BadLen();
        bytes32 h =
            keccak256(abi.encode(address(this), nonce, weightsBps, pricesE18));
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
