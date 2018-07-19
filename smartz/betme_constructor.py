from smartz.api.constructor_engine import ConstructorInstance


class Constructor(ConstructorInstance):

    def get_version(self):
        return {
            "result": "success",
            "version": 1
        }

    def get_params(self):
        json_schema = {
            "type": "object",
            "required": [
                "assertion", "deadline", "feePercent"
            ],
            "additionalProperties": True,

            "properties": {
                "assertion": {
                    "title": "Assertion text",
                    "description": "You as owner of contract will bet this assertion is true, while your opponent will bet it is false.",
                    "type": "string",
                    "minLength": 3,
                    "maxLength": 400,
                    "pattern": "^.+$"
                },
                "deadline": {
                    "title": "Deadline",
                    "description": "Dispute should be resolved before this point in time, otherwise no one considered a winner. Choose date in the future, otherwise deploy will fail",
                    "$ref": "#/definitions/unixTime",
                },
                "arbiterAddr": {
                    "title": "Arbiter ethereum address",
                    "description": "Arbiter desides is the assertion true or false. Leave this field blank to choose arbiter later",
                    "$ref": "#/definitions/address"
                },
                "feePercent": {
                    "title": "Arbiter fee percent",
                    "description": "Arbiter fee as % of bet amount [0-100). If you bet for 1 ether and feePercent is 10, then arbiter will receive 0.1 ether, and the winner will receive 0.9 ether",
                    "$ref": "#/definitions/ethCount"
                },
                "opponentAddr": {
                    "title": "Opponent ethereum address",
                    "description": "You may leave this field blank to let anyone bet against your assertion or set opponent address later",
                    "$ref": "#/definitions/address"
                },
            }
        }

        ui_schema = {
            "deadline": {
                "ui:widget": "unixTime",
            },
            "feePercent": {
                "ui:widget": "ethCount",
            },
        }

        return {
            "result": "success",
            "schema": json_schema,
            "ui_schema": ui_schema
        }

    def construct(self, fields):
        #variants_code = ''

        #for variant_id, variant in enumerate(fields['variants']):
        #    variants_code += """
        #        variants.push('{variant_descr}');variantIds[sha256('{variant_descr}')] = {variant_id};
        #    """.format(
        #        variant_descr=variant,
        #        variant_id=variant_id+1
        #    )
        zeroAddr = 'address(0)'
        arbiterAddr = fields.get('arbiterAddr', zeroAddr) or zeroAddr
        opponentAddr = fields.get('opponentAddr', zeroAddr) or zeroAddr

        source = self.__class__._TEMPLATE \
            .replace('%assertion%', fields['assertion']) \
            .replace('%deadline%', str(fields['deadline'])) \
            .replace('%feePercent%', str(fields['feePercent'])) \
            .replace('%arbiterAddr%', arbiterAddr) \
            .replace('%opponentAddr%', opponentAddr) \

        return {
            "result": "success",
            'source': source,
            'contract_name': "BetMeWrapper"
        }

    def post_construct(self, fields, abi_array):

        function_titles = {
            'bet': {
                'title': 'Owner bets assertion is true',
                'description': 'send ether to this function to bet on assertion text'
            },

        }

        return {
            "result": "success",
            'function_specs': function_titles,
            'dashboard_functions': ['IsArbiterAddressConfirmed', 'IsOpponentBetConfirmed',]
        }


    # language=Solidity
    _TEMPLATE = """
pragma solidity ^0.4.20;

library SafeMath {

  /**
  * @dev Multiplies two numbers, throws on overflow.
  */
  function mul(uint256 a, uint256 b) internal pure returns (uint256 c) {
    // Gas optimization: this is cheaper than asserting 'a' not being zero, but the
    // benefit is lost if 'b' is also tested.
    // See: https://github.com/OpenZeppelin/openzeppelin-solidity/pull/522
    if (a == 0) {
      return 0;
    }

    c = a * b;
    assert(c / a == b);
    return c;
  }

  /**
  * @dev Integer division of two numbers, truncating the quotient.
  */
  function div(uint256 a, uint256 b) internal pure returns (uint256) {
    // assert(b > 0); // Solidity automatically throws when dividing by 0
    // uint256 c = a / b;
    // assert(a == b * c + a % b); // There is no case in which this doesn't hold
    return a / b;
  }

  /**
  * @dev Subtracts two numbers, throws on overflow (i.e. if subtrahend is greater than minuend).
  */
  function sub(uint256 a, uint256 b) internal pure returns (uint256) {
    assert(b <= a);
    return a - b;
  }

  /**
  * @dev Adds two numbers, throws on overflow.
  */
  function add(uint256 a, uint256 b) internal pure returns (uint256 c) {
    c = a + b;
    assert(c >= a);
    return c;
  }
}

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

	function BetMe(
		string  _assertion,
		uint256 _deadline,
		uint256 _fee,
		address _arbiterAddr,
		address _opponentAddr
	) public {
		OwnerAddress = msg.sender;
		_setAssertionText(_assertion);
		_setDeadline(_deadline);
		_setArbiterFee(_fee);
		ArbiterAddress  = _arbiterAddr;
		OpponentAddress = _opponentAddr;
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

	function IsArbiterLazyBastard() internal view returns (bool) {
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
		uint256 _value = ArbiterPenaltyAmount;
		IsArbiterAddressConfirmed = false;
		ArbiterPenaltyAmount = 0;
		if (_value > 0 ) {
			ArbiterAddress.transfer(_value);
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
		if (IsArbiterLazyBastard()) return;
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
		if (IsArbiterLazyBastard()) return 0;
		if (!ArbiterHasVoted || IsDecisionMade) {
			amount = ArbiterFeeAmountInEther();
		}
		if (IsArbiterAddressConfirmed) {
			amount = amount.add(ArbiterPenaltyAmount);
		}
	}

	function IsOpponentTransferPending() internal view returns (bool) {
		if (IsOpponentTransferMade) return false;
		if (IsArbiterLazyBastard()) return true;
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

contract BetMeWrapper is BetMe("%assertion%", %deadline%, %feePercent%, %arbiterAddr%, %opponentAddr%){}
    """