// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title Unravix Proof
/// @notice Confidential quizzes on Fhenix CoFHE.
///  - The answer key is stored encrypted, so nobody (not even chain readers) can copy it.
///  - Each student's answers are submitted encrypted and graded with FHE (no branching on secrets).
///  - Scores stay encrypted; only the student (and this contract) can decrypt their own score.
///  - A student may choose to reveal ONLY whether they passed, earning a public "mastered" credential.
contract UnravixProof {
    struct Quiz {
        string topic;
        uint8 questionCount;
        uint8 passMark;      // public pass threshold (number of correct answers)
        bool exists;
        euint8[] key;        // encrypted answer key (one option index per question)
    }

    struct Attempt {
        euint8 score;        // encrypted number of correct answers
        ebool passed;        // encrypted pass/fail
        bool submitted;
    }

    address public owner;
    uint256 public quizCount;

    mapping(uint256 => Quiz) private quizzes;
    mapping(uint256 => mapping(address => Attempt)) private attempts;
    /// @notice Public credential: student mastered quiz (set only after a verified reveal).
    mapping(address => mapping(uint256 => bool)) public mastered;

    event QuizCreated(uint256 indexed quizId, string topic, uint8 questionCount, uint8 passMark);
    event AttemptSubmitted(uint256 indexed quizId, address indexed student);
    event PassRevealRequested(uint256 indexed quizId, address indexed student);
    event Mastered(uint256 indexed quizId, address indexed student, string topic);

    error NotOwner();
    error NoQuiz();
    error BadLength();
    error AlreadySubmitted();
    error NoAttempt();
    error NotPassed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Create a quiz with an encrypted answer key (one encrypted batch, one signature).
    function createQuiz(
        string calldata topic,
        uint8 passMark,
        externalEuint8[] calldata encryptedKey,
        bytes calldata signature
    ) external onlyOwner returns (uint256 quizId) {
        uint256 n = encryptedKey.length;
        if (n == 0 || n > 50 || passMark == 0 || passMark > n) revert BadLength();

        euint8[] memory key = FHE.asEuint8s(encryptedKey, signature);
        quizId = ++quizCount;
        Quiz storage q = quizzes[quizId];
        q.topic = topic;
        q.questionCount = uint8(n);
        q.passMark = passMark;
        q.exists = true;
        for (uint256 i = 0; i < n; i++) {
            FHE.allowThis(key[i]);   // only the contract may use the key; never the sender or public
            q.key.push(key[i]);
        }
        emit QuizCreated(quizId, topic, uint8(n), passMark);
    }

    /// @notice Submit encrypted answers. Graded fully under encryption.
    function submit(
        uint256 quizId,
        externalEuint8[] calldata encryptedAnswers,
        bytes calldata signature
    ) external {
        Quiz storage q = quizzes[quizId];
        if (!q.exists) revert NoQuiz();
        if (encryptedAnswers.length != q.questionCount) revert BadLength();
        Attempt storage a = attempts[quizId][msg.sender];
        if (a.submitted) revert AlreadySubmitted();

        euint8[] memory ans = FHE.asEuint8s(encryptedAnswers, signature);
        euint8 one = FHE.asEuint8(1);
        euint8 zero = FHE.asEuint8(0);
        euint8 score = FHE.asEuint8(0);
        for (uint256 i = 0; i < ans.length; i++) {
            // no branching on encrypted data: select 1 or 0
            score = FHE.add(score, FHE.select(FHE.eq(ans[i], q.key[i]), one, zero));
        }
        ebool passed = FHE.gte(score, FHE.asEuint8(q.passMark));

        FHE.allowThis(score);
        FHE.allow(score, msg.sender);
        FHE.allowThis(passed);
        FHE.allow(passed, msg.sender);

        a.score = score;
        a.passed = passed;
        a.submitted = true;
        emit AttemptSubmitted(quizId, msg.sender);
    }

    /// @notice Student opts in to make ONLY their pass/fail publicly decryptable (score stays private).
    function requestPassReveal(uint256 quizId) external {
        Attempt storage a = attempts[quizId][msg.sender];
        if (!a.submitted) revert NoAttempt();
        FHE.allowPublic(a.passed);
        emit PassRevealRequested(quizId, msg.sender);
    }

    /// @notice Publish the Threshold-Network-signed pass result; mints the public credential if passed.
    function claimMastery(uint256 quizId, bool passedPlain, bytes calldata signature) external {
        Attempt storage a = attempts[quizId][msg.sender];
        if (!a.submitted) revert NoAttempt();
        FHE.publishDecryptResult(a.passed, passedPlain, signature);
        if (!passedPlain) revert NotPassed();
        mastered[msg.sender][quizId] = true;
        emit Mastered(quizId, msg.sender, quizzes[quizId].topic);
    }

    // ---- views (return ciphertext handles; decrypt client-side with permit) ----
    function myScore(uint256 quizId) external view returns (euint8) {
        return attempts[quizId][msg.sender].score;
    }

    function myPassed(uint256 quizId) external view returns (ebool) {
        return attempts[quizId][msg.sender].passed;
    }

    function quizInfo(uint256 quizId) external view returns (string memory topic, uint8 questionCount, uint8 passMark) {
        Quiz storage q = quizzes[quizId];
        if (!q.exists) revert NoQuiz();
        return (q.topic, q.questionCount, q.passMark);
    }

    function hasSubmitted(uint256 quizId, address student) external view returns (bool) {
        return attempts[quizId][student].submitted;
    }
}
