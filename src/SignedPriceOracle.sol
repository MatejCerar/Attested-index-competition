// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// On-chain store for enclave-signed prices. setPrice takes a batch of
/// (symbol, priceE18) pairs plus the signature the enclave produced over
/// keccak256(abi.encode(symbols, pricesE18, timestamp)) - the same payload
/// pipeline/oracle/oracle.mjs builds - and reverts unless it recovers the
/// trusted signer. Prices are USD 1e18 per symbol, matching the vault's NAV
/// math and MockUniswapV3Pool.priceUsdE18; SignedPriceFeed below exposes the
/// pool's exact no-arg getter so it is drop-in.
contract SignedPriceOracle {
    address public immutable signer;
    uint256 public lastTimestamp;

    mapping(bytes32 => uint256) internal priceOf; // keccak256(symbol) => 1e18
    mapping(bytes32 => uint256) internal setAt;

    event PricesSet(string[] symbols, uint256[] pricesE18, uint256 timestamp);

    error BadSig();
    error BadLen();
    error Stale();

    constructor(address _signer) {
        signer = _signer;
    }

    function setPrice(
        string[] calldata symbols,
        uint256[] calldata pricesE18,
        uint256 timestamp,
        bytes calldata sig
    ) external {
        if (symbols.length != pricesE18.length || symbols.length == 0) {
            revert BadLen();
        }
        if (timestamp < lastTimestamp) revert Stale();
        bytes32 h = keccak256(abi.encode(symbols, pricesE18, timestamp));
        if (ECDSA.recover(ECDSA.toEthSignedMessageHash(h), sig) != signer) {
            revert BadSig();
        }
        for (uint256 i; i < symbols.length; i++) {
            bytes32 k = keccak256(bytes(symbols[i]));
            priceOf[k] = pricesE18[i];
            setAt[k] = timestamp;
        }
        lastTimestamp = timestamp;
        emit PricesSet(symbols, pricesE18, timestamp);
    }

    function priceUsdE18(string calldata symbol)
        external
        view
        returns (uint256)
    {
        return priceOf[keccak256(bytes(symbol))];
    }

    function updatedAt(string calldata symbol) external view returns (uint256) {
        return setAt[keccak256(bytes(symbol))];
    }
}

/// One-symbol view over the oracle with the same no-arg priceUsdE18() getter
/// as MockUniswapV3Pool, so a vault reads either interchangeably.
contract SignedPriceFeed {
    SignedPriceOracle public immutable oracle;
    string public symbol;

    constructor(SignedPriceOracle _oracle, string memory _symbol) {
        oracle = _oracle;
        symbol = _symbol;
    }

    function priceUsdE18() external view returns (uint256) {
        return oracle.priceUsdE18(symbol);
    }
}
