pragma solidity ^0.4.24;

import "../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";

contract BetMe {
	using SafeMath for uint256;

	string public Assertion;
	uint256 public Deadline;
	uint256 public ArbiterFee;
	uint256 public ArbiterPenaltyAmount;

	uint256 public StateVersion;
	uint256 private betAmount;

	address public OwnerAddress;
	address public ArbiterAddress;
	address public OpponentAddress;

	bool public IsArbiterAddressConfirmed;
	bool public IsOpponentBetConfirmed;
	bool public ArbiterHasVoted;
	bool public IsDecisionMade;
	bool public IsAssertionTrue;
	bool public IsOwnerTransferMade;
	bool public IsArbiterTransferMade;
	bool public IsOpponentTransferMade;

	constructor(
		string  _assertion,
		uint256 _deadline,
		uint256 _fee,
		address _arbiterAddr,
		address _opponentAddr,
		uint256 _arbiterPenaltyAmount
	) public {
		OwnerAddress = msg.sender;
		_setAssertionText(_assertion);
		_setDeadline(_deadline);
		_setArbiterFee(_fee);
		ArbiterAddress  = _arbiterAddr;
		OpponentAddress = _opponentAddr;
		ArbiterPenaltyAmount = _arbiterPenaltyAmount;
	}

	modifier onlyOwner() {
		require(msg.sender == OwnerAddress);
		_;
	}

	modifier forbidOwner() {
		require(msg.sender != OwnerAddress);
		_;
	}

	modifier onlyArbiter() {
		require(msg.sender == ArbiterAddress);
		_;
	}

	modifier forbidArbiter() {
		require(msg.sender != ArbiterAddress);
		_;
	}

	modifier ensureTimeToVote() {
		require(IsVotingInProgress());
		_;
	}

	modifier onlyArbiterCandidate() {
		require(!IsArbiterAddressConfirmed);
		require(msg.sender == ArbiterAddress);
		_;
	}

	modifier increaseState() {
		StateVersion = StateVersion.add(1);
		_;
	}

	modifier whileBetNotMade() {
		require(betAmount == 0);
		_;
	}

	modifier requireOwnerBetIsMade() {
		require(betAmount != 0);
		_;
	}

	modifier requireArbiterNotConfirmed() {
		require(!IsArbiterAddressConfirmed);
		_;
	}

	modifier stateNumberMatches(uint256 _agreedState) {
		require(StateVersion == _agreedState);
		_;
	}

	modifier requireArbiterConfirmed() {
		require(IsArbiterAddressConfirmed);
		_;
	}

	modifier requireOpponentBetIsNotMade() {
		require(!IsOpponentBetConfirmed);
		_;
	}

	function IsVotingInProgress() internal view returns (bool) {
		return IsArbiterAddressConfirmed && IsOpponentBetConfirmed && !ArbiterHasVoted && getTime() < Deadline;
	}

	function IsArbiterLazy() internal view returns (bool) {
		return (IsOpponentBetConfirmed && getTime() > Deadline && !ArbiterHasVoted);
	}

	function getTime() public view returns (uint256) {
		return now;
	}

	function setAssertionText(string _text) public onlyOwner increaseState whileBetNotMade {
		_setAssertionText(_text);
	}

	function _setAssertionText(string _text) internal {
		require(bytes(_text).length > 0);
		Assertion = _text;
	}

	function setDeadline(uint256 _timestamp) public onlyOwner increaseState requireArbiterNotConfirmed {
		_setDeadline(_timestamp);
	}

	function _setDeadline(uint256 _timestamp) internal {
		require(_timestamp > getTime());
		Deadline = _timestamp;
	}

	function setArbiterFee(uint256 _percent) public onlyOwner requireArbiterNotConfirmed increaseState {
		_setArbiterFee(_percent);
	}

	function _setArbiterFee(uint256 _percent) internal {
		require(_percent < 100e18); // 100.0% float as integer with decimal=18
		ArbiterFee      = _percent;
	}

	function setOpponentAddress(address _addr) public 
		onlyOwner 
		increaseState
		requireOpponentBetIsNotMade
	{
		require(_addr != address(OpponentAddress));
		require(_addr != address(OwnerAddress));
		require(_addr != address(ArbiterAddress) || _addr == address(0));
		OpponentAddress = _addr;
	}

	function setArbiterAddress(address _addr) public onlyOwner requireArbiterNotConfirmed increaseState {
		require(_addr != address(ArbiterAddress));
		require(_addr != address(OwnerAddress));
		require(_addr != address(OpponentAddress) || _addr == address(0));
		ArbiterAddress = _addr;
	}

	function bet() public payable onlyOwner whileBetNotMade {
		require(msg.value > 0);
		betAmount = msg.value;
	}

	function currentBet() public view returns (uint256) {
		return betAmount;
	}

	function setArbiterPenaltyAmount(uint256 _amount) public onlyOwner requireArbiterNotConfirmed increaseState {
		require(_amount != ArbiterPenaltyAmount);
		ArbiterPenaltyAmount = _amount;
	}

	function agreeToBecameArbiter(uint256 _agreedState) public payable 
		onlyArbiterCandidate
		requireOwnerBetIsMade 
		stateNumberMatches(_agreedState)
	{
		require(ArbiterAddress != address(0));
		require(msg.value == ArbiterPenaltyAmount);
		IsArbiterAddressConfirmed = true;
	}

	function arbiterSelfRetreat() public onlyArbiter requireArbiterConfirmed requireOpponentBetIsNotMade {
		IsArbiterAddressConfirmed = false;
		if (ArbiterPenaltyAmount > 0 ) {
			ArbiterAddress.transfer(ArbiterPenaltyAmount);
		}
	}

	function betAssertIsFalse(uint256 _agreedState) public payable 
		requireOwnerBetIsMade 
		forbidOwner
		requireArbiterConfirmed
		forbidArbiter
		stateNumberMatches(_agreedState) 
		requireOpponentBetIsNotMade
	{
		require(msg.value == betAmount);
		if (OpponentAddress == address(0)) {
			OpponentAddress = msg.sender;
		} else {
			require(OpponentAddress == msg.sender);
		}
		IsOpponentBetConfirmed = true;
	}

	function agreeAssertionTrue() public onlyArbiter ensureTimeToVote {
		ArbiterHasVoted = true;
		IsDecisionMade = true;
		IsAssertionTrue = true;
	}

	function agreeAssertionFalse() public onlyArbiter ensureTimeToVote {
		ArbiterHasVoted = true;
		IsDecisionMade = true;
	}

	function agreeAssertionUnresolvable() public onlyArbiter ensureTimeToVote {
		ArbiterHasVoted = true;
	}

	function withdraw() public {
		require(ArbiterHasVoted || getTime() > Deadline);
		if (msg.sender == ArbiterAddress) {
			withdrawArbiter();
		} else if (msg.sender == OwnerAddress) {
			withdrawOwner();
		} else if (msg.sender == OpponentAddress) {
			withdrawOpponent();
		} else {
			revert();
		}
	}

	function withdrawArbiter() internal {
		require(!IsArbiterTransferMade);
		IsArbiterTransferMade = true;
		if (IsArbiterLazy()) return;
		uint256 amount = IsArbiterAddressConfirmed ? ArbiterPenaltyAmount : 0;
		if (ArbiterHasVoted && IsDecisionMade) {
			amount = amount.add(ArbiterFeeAmountInEther());
		}
		if (amount > 0) ArbiterAddress.transfer(amount);
	}

	function withdrawOwner() internal {
		require(!IsDecisionMade || IsAssertionTrue);
		require(!IsOwnerTransferMade);
		IsOwnerTransferMade = true;
		OwnerAddress.transfer(ownerPayout());
	}

	function withdrawOpponent() internal {
		require(IsOpponentTransferPending());
		IsOpponentTransferMade = true;
		OpponentAddress.transfer(opponentPayout());
	}

	function ArbiterFeeAmountInEther() public view returns (uint256){
		return betAmount.mul(ArbiterFee).div(1e20);
	}
	
	function WinnerPayout() internal view returns (uint256) {
		return betAmount.mul(2).sub(ArbiterFeeAmountInEther());
	}

	function ownerPayout() public view returns (uint256) {
		if ( getTime() > Deadline && !ArbiterHasVoted && IsOpponentBetConfirmed) {
			return betAmount.add(ArbiterPenaltyAmount.div(2));
		}
		if (ArbiterHasVoted && IsDecisionMade) {
			return (IsAssertionTrue ? WinnerPayout() : 0);
		} else {
			return betAmount;
		}
	}

	function opponentPayout() public view returns (uint256) {
		if (getTime() > Deadline && !ArbiterHasVoted) {
			return betAmount.add(ArbiterPenaltyAmount.div(2));
		}
		if (ArbiterHasVoted && IsDecisionMade) {
			return (IsAssertionTrue ? 0 : WinnerPayout());
		}
		return IsOpponentBetConfirmed ? betAmount : 0;
	}

	function arbiterPayout() public view returns (uint256 amount) {
		if (IsArbiterLazy()) return 0;
		if (!ArbiterHasVoted || IsDecisionMade) {
			amount = ArbiterFeeAmountInEther();
		}
		if (IsArbiterAddressConfirmed) {
			amount = amount.add(ArbiterPenaltyAmount);
		}
	}

	function IsOpponentTransferPending() internal view returns (bool) {
		if (IsOpponentTransferMade) return false;
		if (IsArbiterLazy()) return true;
		if (ArbiterHasVoted && !IsAssertionTrue) return true;
		return false;
	}

	function deleteContract() public onlyOwner {
		require(!IsVotingInProgress());
		require(!IsOpponentTransferPending());
		if (IsArbiterAddressConfirmed && !IsArbiterTransferMade) {
			withdrawArbiter();
		}
		selfdestruct(OwnerAddress);
	}
}
