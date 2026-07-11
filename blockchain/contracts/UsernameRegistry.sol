// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

// Standalone username registry: no dependency on DecentralizedForum or any
// other contract. Rules are objective only - length, charset, uniqueness -
// per the "no on-chain word list" requirement; profanity/reserved-word
// screening lives client-side in usernamePolicy.ts.
contract UsernameRegistry {
    uint256 public constant USERNAME_MIN_LENGTH = 3;
    uint256 public constant USERNAME_MAX_LENGTH = 20;

    // Spam guard for changeUsername: no fee, just a cooldown between changes.
    // Avoids any need for a treasury address or a withdraw function.
    uint256 public constant USERNAME_CHANGE_COOLDOWN = 7 days;

    mapping(address => string) private usernames;
    mapping(bytes32 => bool) private usernameExists;
    mapping(bytes32 => address) private usernameOwner;
    mapping(address => uint256) private lastChangedAt;

    error EmptyUsername();
    error UsernameAlreadyTaken();
    error UsernameAlreadySet();
    error UsernameTooShort();
    error UsernameTooLong();
    error InvalidUsernameCharacter();
    error NoUsernameSet();
    error UsernameChangeOnCooldown();

    event UsernameRegistered(
        address indexed user,
        string username,
        uint256 registeredAt
    );

    event UsernameChanged(
        address indexed user,
        string oldUsername,
        string newUsername,
        uint256 changedAt
    );

    function registerUsername(string calldata username) external {
        if (bytes(usernames[msg.sender]).length != 0) {
            revert UsernameAlreadySet();
        }

        _validateUsername(username);

        bytes32 nameHash = keccak256(bytes(username));
        if (usernameExists[nameHash]) {
            revert UsernameAlreadyTaken();
        }

        usernameExists[nameHash] = true;
        usernameOwner[nameHash] = msg.sender;
        usernames[msg.sender] = username;

        emit UsernameRegistered(msg.sender, username, block.timestamp);
    }

    function changeUsername(string calldata newUsername) external {
        string memory oldUsername = usernames[msg.sender];

        if (bytes(oldUsername).length == 0) {
            revert NoUsernameSet();
        }

        if (block.timestamp < lastChangedAt[msg.sender] + USERNAME_CHANGE_COOLDOWN) {
            revert UsernameChangeOnCooldown();
        }

        _validateUsername(newUsername);

        bytes32 newHash = keccak256(bytes(newUsername));
        if (usernameExists[newHash]) {
            revert UsernameAlreadyTaken();
        }

        bytes32 oldHash = keccak256(bytes(oldUsername));
        delete usernameExists[oldHash];
        delete usernameOwner[oldHash];
        usernameExists[newHash] = true;
        usernameOwner[newHash] = msg.sender;
        usernames[msg.sender] = newUsername;
        lastChangedAt[msg.sender] = block.timestamp;

        emit UsernameChanged(msg.sender, oldUsername, newUsername, block.timestamp);
    }

    // Enforces format (charset, length) only. Anti-impersonation/profanity
    // filtering is handled client-side; the chain only guarantees what it can
    // verify cheaply and objectively.
    function _validateUsername(string calldata username) private pure {
        bytes memory nameBytes = bytes(username);

        if (nameBytes.length < USERNAME_MIN_LENGTH) {
            revert UsernameTooShort();
        }

        if (nameBytes.length > USERNAME_MAX_LENGTH) {
            revert UsernameTooLong();
        }

        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 c = nameBytes[i];
            bool isLowerCase = (c >= 0x61 && c <= 0x7a);
            bool isUpperCase = (c >= 0x41 && c <= 0x5a);
            bool isDigit = (c >= 0x30 && c <= 0x39);
            bool isUnderscore = (c == 0x5f);

            if (!isLowerCase && !isUpperCase && !isDigit && !isUnderscore) {
                revert InvalidUsernameCharacter();
            }
        }
    }

    function getUsername(address user) external view returns (string memory) {
        return usernames[user];
    }

    function getAddressByUsername(string calldata username) external view returns (address) {
        return usernameOwner[keccak256(bytes(username))];
    }

    function isUsernameAvailable(string calldata username) external view returns (bool) {
        if (bytes(username).length == 0) {
            return false;
        }

        return !usernameExists[keccak256(bytes(username))];
    }

    function getCooldownRemaining(address user) external view returns (uint256) {
        uint256 readyAt = lastChangedAt[user] + USERNAME_CHANGE_COOLDOWN;
        if (block.timestamp >= readyAt) {
            return 0;
        }
        return readyAt - block.timestamp;
    }
}
