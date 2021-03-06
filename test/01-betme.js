'use strict';

import expectThrow from '../node_modules/openzeppelin-solidity/test/helpers/expectThrow';
import expectEvent from '../node_modules/openzeppelin-solidity/test/helpers/expectEvent';

const BigNumber = web3.BigNumber;
const chai =require('chai');
chai.use(require('chai-bignumber')(BigNumber));
chai.use(require('chai-as-promised')); // Order is important
chai.should();

const BetMe = artifacts.require("BetMe");
const MockBetMe = artifacts.require("MockBetMe");
const UnpayableArbiter = artifacts.require("UnpayableArbiter");

function daysInFutureTimestamp(days) {
	const now = new Date();
	const futureDate = new Date(+now + 86400 * days);
	return Math.trunc(futureDate.getTime()/1000);
}

const defaultAssertion = "Norman can light his Zippo cigarette lighter ten times in a row";
const defaultDeadlineDate = daysInFutureTimestamp(14);
const defaultArbiterFee = web3.toWei('1.5');
const defaultArbiterPenaltyAmount = web3.toWei('0');
const zeroAddr = '0x0000000000000000000000000000000000000000';

function constructorArgs(defaults) {
	defaults = defaults == null ? {} : defaults;
	return [
		('Assertion' in defaults ? defaults.Assertion : defaultAssertion),
		('Deadline' in defaults ? defaults.Deadline : defaultDeadlineDate),
		('ArbiterFee' in defaults ? defaults.ArbiterFee : defaultArbiterFee),
		('ArbiterAddress' in defaults ? defaults.ArbiterAddress : zeroAddr),
		('OpponentAddress' in defaults ? defaults.OpponentAddress : zeroAddr),
		('ArbiterPenaltyAmount' in defaults ? defaults.ArbiterPenaltyAmount : defaultArbiterPenaltyAmount),
	];
}

async function expectNoContract(promise) {
	const patternString = "is not a contract address";
  try { await promise; } catch (error) {
		error.message.should.contain(patternString);
		return;
  }
	assert.fail(null, null, 'promise expected to fail with error containing "' + patternString + '", but it does not');
};

async function assertBalanceDiff(callInfo, wantEtherDiff, watchList = {}) {
	if (typeof(watchList) !== "object") watchList = {};
	const etherBefore = web3.eth.getBalance(callInfo.address);
	let history = {};
	Reflect.ownKeys(watchList).forEach(addr => {
		history[addr] = {before: new BigNumber(web3.eth.getBalance(addr)), wantDiff: watchList[addr],};
	});

	const ret = await callInfo.func(...callInfo.args, {from: callInfo.address, gasPrice: callInfo.gasPrice});
	const gasUsed = new BigNumber(ret.receipt.gasUsed);

	const etherAfter = web3.eth.getBalance(callInfo.address);
	const etherUsed = gasUsed.mul(callInfo.gasPrice);
	etherAfter.sub(etherBefore).add(etherUsed).should.be.bignumber.equal(wantEtherDiff);

	Reflect.ownKeys(history).forEach(addr => {
		let diff = (new BigNumber(web3.eth.getBalance(addr))).sub(history[addr].before);
		if (addr === callInfo.address) {
			diff = diff.add(etherUsed);
		}
		diff.should.be.bignumber.equal(history[addr].wantDiff);
	});
}


function newBetCase(inst, acc, opt) {
	opt = opt ? opt : {};
	let obj = {inst, opt, acc};
	if (!('penaltyAmount' in opt)) {obj.opt.penaltyAmount = web3.toWei('30', 'finney')};
	if (!('betAmount' in opt)) {obj.opt.betAmount = web3.toWei('50', 'finney')};
	if (!('feePercent' in opt)) {obj.opt.feePercent = web3.toWei('10')};

	obj.setArbiterFee = async function (_val) {
		if ( _val != null ) {this.opt.feePercent = _val;}
		await this.inst.setArbiterFee(this.opt.feePercent, {from: acc.owner}).should.eventually.be.fulfilled;
	};
	obj.bet = async function (_val) {
		if (_val != null) {this.opt.betAmount = _val;}
		await this.inst.bet({from: this.acc.owner, value: this.opt.betAmount}).should.eventually.be.fulfilled;
	};
	obj.setArbiterAddress = async function (_val) {
		const arbiterAddress = _val == null ?	this.acc.arbiter : _val;
		await this.inst.setArbiterAddress(arbiterAddress, {from: this.acc.owner}).should.eventually.be.fulfilled;
	};
	obj.setOpponentAddress = async function (_val) {
		const opponentAddress = _val == null ?	this.acc.opponent : _val;
		await this.inst.setOpponentAddress(opponentAddress, {from: this.acc.owner}).should.eventually.be.fulfilled;
	};
	obj.setArbiterPenaltyAmount = async function (_val) {
		if (_val != null) {this.opt.penaltyAmount = _val;}
		await this.inst.setArbiterPenaltyAmount(this.opt.penaltyAmount, {from: this.acc.owner}).should.eventually.be.fulfilled;
	};
	obj.agreeToBecameArbiter = async function () {
		const penaltyAmount = await this.inst.ArbiterPenaltyAmount({from: this.acc.anyone});
		const arbiterAddress = await this.inst.ArbiterAddress({from: this.acc.anyone});
		const agreedStateVersion = await this.inst.StateVersion({from: this.acc.anyone});
		await this.inst.agreeToBecameArbiter(agreedStateVersion, {from: arbiterAddress, value: penaltyAmount}).should.eventually.be.fulfilled;
	};
	obj.betAssertIsFalse = async function () {
		const betAmount = await this.inst.currentBet({from: this.acc.anyone});
		const agreedStateVersion = await this.inst.StateVersion({from: this.acc.anyone});
		await this.inst.betAssertIsFalse(agreedStateVersion, {from: this.acc.opponent, value: betAmount}).should.eventually.be.fulfilled;
	};
	obj.agreeAssertionTrue = async function () {
		const arbiterAddress = await this.inst.ArbiterAddress({from: this.acc.anyone});
		await this.inst.agreeAssertionTrue({from: arbiterAddress}).should.eventually.be.fulfilled;
	};
	obj.agreeAssertionFalse = async function () {
		const arbiterAddress = await this.inst.ArbiterAddress({from: this.acc.anyone});
		await this.inst.agreeAssertionFalse({from: arbiterAddress}).should.eventually.be.fulfilled;
	};
	obj.agreeAssertionUnresolvable = async function () {
		const arbiterAddress = await this.inst.ArbiterAddress({from: this.acc.anyone});
		await this.inst.agreeAssertionUnresolvable({from: arbiterAddress}).should.eventually.be.fulfilled;
	};
	obj.setTimeAfterDeadline = async function () {
		const newValue = (await this.inst.Deadline()).add(3600);
		await this.inst.setTime(newValue, {from: this.acc.owner}).should.eventually.be.fulfilled;
	};
	obj.preconditionArbiterIsChoosenAndAgree = async function (opt) {
		opt = opt == null ? {} : opt;
		const setPenaltyAmount = 'setPenaltyAmount' in opt ? opt.setPenaltyAmount : true;
		const arbiterAddress = 'arbiterAddress' in opt ? opt.arbiterAddress : acc.arbiter;
		if ('betAmount' in opt) {this.opt.betAmount = opt.betAmount;}

		if (!setPenaltyAmount) {
			this.opt.penaltyAmount = 0;
		} else if ('penaltyAmount' in opt) {
			this.opt.penaltyAmount = opt.penaltyAmount;
		}

		await this.bet(this.opt.betAmount);
		if (setPenaltyAmount) {
			await this.setArbiterPenaltyAmount(this.opt.penaltyAmount);
		}
		await this.setArbiterAddress(arbiterAddress);
		await this.setArbiterFee();
		await this.agreeToBecameArbiter();
	}
	obj.preconditionOpponentBetIsMade = async function(opt) {
		await this.preconditionArbiterIsChoosenAndAgree(opt);
		await this.betAssertIsFalse();
		await this.inst.IsOpponentBetConfirmed({from: acc.anyone}).should.be.eventually.true;
		await this.inst.OpponentAddress({from: acc.anyone}).should.be.eventually.equal(this.acc.opponent);
	}
	obj.preconditionAssertTreueAndPayoutsMade = async function(opt) {
		await this.preconditionOpponentBetIsMade(opt);
		await this.agreeAssertionTrue();
		await this.inst.withdraw({from: acc.owner}).should.be.eventually.fulfilled;
		await this.inst.withdraw({from: acc.arbiter}).should.be.eventually.fulfilled;
		web3.eth.getBalance(this.inst.address).should.be.bignumber.equal(0);
	}
	return obj;
}

contract('BetMe - constructor and setters', function(accounts) {
	const acc = {anyone: accounts[0], owner: accounts[1], opponent: accounts[2], arbiter: accounts[3]};

	beforeEach(async function () {
		this.inst = await BetMe.new(...constructorArgs(), {from: acc.owner},);
	});

	it('should have initial stateVersion == 0', async function() {
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.zero;
	});

	it('should provide public getter for Assertion', async function() {
		await this.inst.Assertion({from: acc.anyone}).should.eventually.be.equal(defaultAssertion);
	});

	it('should provide public getter for Deadline', async function() {
		await this.inst.Deadline({from: acc.anyone}).should.eventually.be.bignumber.equal(defaultDeadlineDate);
	});

	it('should provide public getter for ArbiterFee', async function() {
		await this.inst.ArbiterFee({from: acc.anyone}).should.eventually.be.bignumber.equal(defaultArbiterFee);
	});

	it('should provide public getter for ArbiterAddress', async function() {
		await this.inst.ArbiterAddress({from: acc.anyone}).should.eventually.be.equal(zeroAddr);
	});

	it('should provide public getter for opponent address', async function() {
		await this.inst.OpponentAddress({from: acc.anyone}).should.eventually.be.equal(zeroAddr);
	});

	it('should provide public getter for ArbiterPenaltyAmount', async function() {
		await this.inst.ArbiterPenaltyAmount({from: acc.anyone}).should.eventually.be.bignumber.equal(defaultArbiterPenaltyAmount);
	});

	it('should set ArbiterPenaltyAmount from constructor args', async function() {
		const ArbiterPenaltyAmount = web3.toWei('100', 'finney');
		this.inst = await BetMe.new(...constructorArgs({ArbiterPenaltyAmount}), {from: acc.owner},);
		await this.inst.ArbiterPenaltyAmount({from: acc.anyone}).should.eventually.be.bignumber.equal(ArbiterPenaltyAmount);
	});

	it('should not allow zero deadline in constructor', async function() {
		await expectThrow(BetMe.new(...constructorArgs({Deadline: 0}),  {from: acc.owner}));
	});

	it('should not allow deadline in the past in constructor', async function() {
		const fifteenMinutesAgo = daysInFutureTimestamp(0) - (15 * 30);
		await expectThrow(BetMe.new(...constructorArgs({Deadline: fifteenMinutesAgo}),  {from: acc.owner}));
	});

	it('should not allow empty assertion text in constructor', async function() {
		await expectThrow(BetMe.new(...constructorArgs({Assertion: ""}),  {from: acc.owner}));
	});

	it('should allow arbiter fee close to 100% in constructor', async function() {
		const maxOkFee = web3.toWei('99.9999');
		const inst = BetMe.new(...constructorArgs({ArbiterFee: maxOkFee}),  {from: acc.owner});
		await inst.should.be.eventually.fulfilled;
	});

	it('should not allow arbiter fee = 100% in constructor', async function() {
		const toMuchFee = web3.toWei('100.0');
		await expectThrow(BetMe.new(...constructorArgs({ArbiterFee: toMuchFee}),  {from: acc.owner}));
	});

	it('should not allow arbiter fee > 100% in constructor', async function() {
		const toMuchFee = web3.toWei('101.0');
		await expectThrow(BetMe.new(...constructorArgs({ArbiterFee: toMuchFee}),  {from: acc.owner}));
	});

	it('should not allow set Assertion text if not owner', async function() {
		await expectThrow(this.inst.setAssertionText("12345", {from: acc.anyone}));
	});

	it('should allow owner set Assertion text and increase state version number', async function() {
		const newAssertion = "square has four corners";
		await this.inst.setAssertionText(newAssertion, {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.Assertion({from: acc.anyone}).should.eventually.be.equal(newAssertion);
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.equal(1);
	});

	it('should not allow owner set empty assertion text', async function() {
		await expectThrow(this.inst.setAssertionText("", {from: acc.owner}));
	});

	it('should not allow change Deadline if not owner', async function() {
		await expectThrow(this.inst.setDeadline(daysInFutureTimestamp(15), {from: acc.anyone}));
	});

	it('should not allow set Deadline in past', async function() {
		const newValue = (await this.inst.Deadline()).sub(3600);
		await expectThrow(this.inst.setDeadline(newValue, {from: acc.owner}));
	});

	it('should allow owner set new Deadline and should increase state version number', async function() {
		const newValue = (await this.inst.Deadline()).add(3600);
		await this.inst.setDeadline(newValue, {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.Deadline({from: acc.anyone}).should.eventually.be.bignumber.equal(newValue);
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.equal(1);
	});

	it('should not allow set ArbiterFee if not owner', async function() {
		const newValue = web3.toWei('10.5');
		await expectThrow(this.inst.setArbiterFee(newValue, {from: acc.anyone}));
	});

	it('should not allow set ArbiterFee = 100%', async function() {
		const newValue = web3.toWei('100');
		await expectThrow(this.inst.setArbiterFee(newValue, {from: acc.anyone}));
	});

	it('should allow owner set new ArbiterFee and should increase state version number', async function() {
		const newValue = web3.toWei('10');
		await this.inst.setArbiterFee(newValue, {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.ArbiterFee({from: acc.anyone}).should.eventually.be.bignumber.equal(newValue);
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.equal(1);
	});

	it('should not allow set OpponentAddress if not owner', async function() {
		await expectThrow(this.inst.setOpponentAddress(acc.opponent, {from: acc.anyone}));
	});

	it('should allow owner set new opponent address and should increase state version number', async function() {
		const newValue = acc.opponent;
		await this.inst.setOpponentAddress(newValue, {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.OpponentAddress({from: acc.anyone}).should.eventually.be.equal(newValue);
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.equal(1);
	});

	it('should allow set opponent address to address(0)', async function() {
		const inst = await BetMe.new(...constructorArgs({OpponentAddress: acc.opponent}),  {from: acc.owner});
		await inst.setOpponentAddress(zeroAddr, {from: acc.owner}).should.eventually.be.fulfilled;
		await inst.OpponentAddress({from: acc.anyone}).should.eventually.be.equal(zeroAddr);
	});

	it('should increase version for every modification of opponent address', async function() {
		await this.inst.setOpponentAddress(acc.opponent, {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.setOpponentAddress(zeroAddr, {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.equal(2);
	});

	it('should revert if setting opponent address to its previews value', async function() {
		await this.inst.setOpponentAddress(acc.opponent, {from: acc.owner}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.setOpponentAddress(acc.opponent, {from: acc.owner}));
	});

	it('should revert if setting arbiter address equal to owner address', async function() {
		await expectThrow(this.inst.setOpponentAddress(acc.owner, {from: acc.owner}));
	});


	it('should revert if setting opponent address equal to arbiter address', async function() {
		await this.inst.setArbiterAddress(acc.opponent, {from: acc.owner}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.setOpponentAddress(acc.opponent, {from: acc.owner}));
	});

	it('should not allow set ArbiterAddress if not owner', async function() {
		await expectThrow(this.inst.setArbiterAddress(acc.arbiter, {from: acc.anyone}));
	});

	it('should allow owner set arbiter address and should increase state version number', async function() {
		const newValue = acc.arbiter;
		await this.inst.setArbiterAddress(newValue, {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.ArbiterAddress({from: acc.anyone}).should.eventually.be.equal(newValue);
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.equal(1);
	});

	it('should allow set arbiter address to address(0)', async function() {
		const inst = await BetMe.new(...constructorArgs({ArbiterAddress: acc.arbiter}),  {from: acc.owner});
		await inst.setArbiterAddress(zeroAddr, {from: acc.owner}).should.eventually.be.fulfilled;
		await inst.ArbiterAddress({from: acc.anyone}).should.eventually.be.equal(zeroAddr);
	});

	it('should revert if setting arbiter address to its previews value', async function() {
		await this.inst.setArbiterAddress(acc.arbiter, {from: acc.owner}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.setArbiterAddress(acc.arbiter, {from: acc.owner}));
	});

	it('should revert if setting arbiter address equal to owner address', async function() {
		await expectThrow(this.inst.setArbiterAddress(acc.owner, {from: acc.owner}));
	});

	it('should revert if setting arbiter address equal to opponent address', async function() {
		await this.inst.setOpponentAddress(acc.arbiter, {from: acc.owner}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.setArbiterAddress(acc.arbiter, {from: acc.owner}));
	});

	it('should increase version for every modification of arbiter address', async function() {
		await this.inst.setArbiterAddress(acc.opponent, {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.setArbiterAddress(zeroAddr, {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.equal(2);
	});

	it('should increase version for every modification of assert text', async function() {
		await this.inst.setAssertionText("text 1", {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.setAssertionText("text2", {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.equal(2);
	});

	it('should increase version for every modification of assert text', async function() {
		await this.inst.setDeadline(daysInFutureTimestamp(15), {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.setDeadline(daysInFutureTimestamp(16), {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.equal(2);
	});
	it('should increase version for every modification of arbiter fee ', async function() {
		await this.inst.setArbiterFee(web3.toWei('15'), {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.setArbiterFee(web3.toWei('0.5'), {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.equal(2);
	});
	it('should increase version for every modification of arbiter penalty amount ', async function() {
		await this.inst.setArbiterPenaltyAmount(web3.toWei('11', 'finney'), {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.setArbiterPenaltyAmount(web3.toWei('0', 'finney'), {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.equal(2);
	});

	it('should not allow set new deadline after deadline if arbiter agreed', async function() {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();
		await testCase.setTimeAfterDeadline();

		const newValue = (await this.inst.Deadline()).add(3600);
		await expectThrow(this.inst.setDeadline(newValue, {from: acc.owner}));
	});

	it('should allow set new deadline after deadline before arbiter agreed', async function() {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.setArbiterAddress();
		await testCase.setArbiterFee();
		await testCase.setArbiterPenaltyAmount();
		await testCase.bet();
		await testCase.setTimeAfterDeadline();

		const newValue = (await this.inst.getTime()).add(1);
		await this.inst.setDeadline(newValue, {from: acc.owner}).should.be.eventually.fulfilled;
	});
});

contract('BetMe - owner bets', function(accounts) {
	const acc = {anyone: accounts[0], owner: accounts[1], opponent: accounts[2], arbiter: accounts[3]};

	beforeEach(async function () {
		this.inst = await BetMe.new(...constructorArgs(), {from: acc.owner},);
	});

	it('should revert if any non-owner calls bet', async function() {
		await expectThrow(this.inst.bet({from: acc.anyone, value: 0.5}));
	});

	it('should allow owner to make a bet', async function() {
		const betAmount = web3.toWei('10', 'finney');
		await this.inst.bet({from: acc.owner, value: betAmount}).should.be.eventually.fulfilled;
		await this.inst.currentBet({from: acc.anyone}).should.be.eventually.bignumber.equal(betAmount);
	});

	it('should revert if bet is zero', async function() {
		await expectThrow(this.inst.bet({from: acc.owner, value: 0}));
	});


	it('should allow make a bet only once', async function() {
		const betAmount = web3.toWei('5', 'finney');
		await this.inst.bet({from: acc.owner, value: betAmount}).should.be.eventually.fulfilled;
		await expectThrow(this.inst.bet({from: acc.owner, value: betAmount}));
	});

	it('should not allow set assertion text after bet is made', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.bet();
		const newAssertion = "square has four corners";
		await expectThrow(this.inst.setAssertionText(newAssertion, {from: acc.owner}));
	});

	it('should revert if opponent calls bet', async function() {
		const betAmount = web3.toWei('10', 'finney');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.setOpponentAddress();
		await expectThrow(this.inst.bet({from: acc.opponent, value: betAmount}));
	});

	it('should revert if arbiter calls bet', async function() {
		const betAmount = web3.toWei('10', 'finney');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.setArbiterAddress(acc.arbiter);
		await expectThrow(this.inst.bet({from: acc.arbiter, value: betAmount}));
	});

});

contract('BetMe - choosing arbiter', function(accounts) {
	const acc = {anyone: accounts[0], owner: accounts[1], opponent: accounts[2], arbiter: accounts[3]};

	beforeEach(async function () {
		this.inst = await BetMe.new(...constructorArgs(), {from: acc.owner},);
	});

	it('should revert if non-owner try to set arbiter penalty amount', async function() {
		const newValue = web3.toWei('50', 'finney');
		await expectThrow(this.inst.setArbiterPenaltyAmount(newValue, {from: acc.anyone}));
	});

	it('should allow to set arbiter fee percent after bet is made', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.bet(web3.toWei('50', 'finney'));

		const newPercent = web3.toWei('0.005');
		await this.inst.setArbiterFee(newPercent, {from: acc.owner}).should.eventually.be.fulfilled;
	});

	it('should allow to set arbiter address after bet is made', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.setArbiterAddress();
		await testCase.bet();
		await this.inst.setArbiterAddress(acc.anyone, {from: acc.owner}).should.eventually.be.fulfilled;
	});

	it('should allow owner set arbiter penalty wei amount and should increase state version number', async function() {
		const newValue = web3.toWei('10', 'finney');
		await this.inst.setArbiterPenaltyAmount(newValue, {from: acc.owner}).should.eventually.be.fulfilled;
		await this.inst.ArbiterPenaltyAmount({from: acc.anyone}).should.eventually.be.bignumber.equal(newValue);
		await this.inst.StateVersion({from: acc.anyone}).should.eventually.be.bignumber.equal(1);
	});

	it('should not allow set arbiter penalty to its previews value', async function() {
		const newValue = web3.toWei('10', 'finney');
		await this.inst.setArbiterPenaltyAmount(newValue, {from: acc.owner}).should.eventually.be.fulfilled;

		await expectThrow(this.inst.setArbiterPenaltyAmount(newValue, {from: acc.owner}));
	});

	it('should allow change arbiter penalty after owner bet is made', async function() {
		const testCase = newBetCase(this.inst, acc, {penaltyAmount: web3.toWei('10', 'finney')});
		await testCase.bet();

		const newValue = web3.toWei('20', 'finney');
		await this.inst.setArbiterPenaltyAmount(newValue, {from: acc.owner}).should.eventually.be.fulfilled;
	});

	it('should not allow to became arbiter before arbiter address is set', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.bet(web3.toWei('50', 'finney'));
		const penaltyAmount = web3.toWei('10', 'finney');
		await testCase.setArbiterPenaltyAmount(penaltyAmount);

		const agreedStateVersion = await this.inst.StateVersion();
		await expectThrow(this.inst.agreeToBecameArbiter(agreedStateVersion, {from: acc.arbiter, value: penaltyAmount}));
	});

	it('should not allow to became arbiter before owner bet is made', async function() {
		const testCase = newBetCase(this.inst, acc, {penaltyAmount: web3.toWei('0.03')});
		await testCase.setArbiterPenaltyAmount();
		await testCase.setArbiterAddress();

		const agreedStateVersion = await this.inst.StateVersion();
		await expectThrow(this.inst.agreeToBecameArbiter(agreedStateVersion, {from: acc.arbiter, value: testCase.opt.penaltyAmount}));
	});

	it('should not allow non-arbiter-candidate to became an arbiter', async function() {
		const testCase = newBetCase(this.inst, acc, {penaltyAmount: web3.toWei('0.03')});
		await testCase.bet();
		await testCase.setArbiterPenaltyAmount();
		await testCase.setArbiterAddress();

		const agreedStateVersion = await this.inst.StateVersion();
		await expectThrow(this.inst.agreeToBecameArbiter(agreedStateVersion, {from: acc.anyone, value: testCase.opt.penaltyAmount}));
	});

	it('should allow arbiter candidate to became an arbiter', async function() {
		const penaltyAmount = web3.toWei('30', 'finney');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.bet(web3.toWei('50', 'finney'));
		await testCase.setArbiterPenaltyAmount(penaltyAmount);
		await testCase.setArbiterAddress();

		await this.inst.IsArbiterAddressConfirmed({from: acc.anyone}).should.eventually.be.false;
		const agreedStateVersion = await this.inst.StateVersion();

		await this.inst.agreeToBecameArbiter(agreedStateVersion, {from: acc.arbiter, value: penaltyAmount}).should.eventually.be.fulfilled;
		await this.inst.IsArbiterAddressConfirmed({from: acc.anyone}).should.eventually.be.true;
	});

	it('should allow arbiter candidate to became an arbiter when penalty amount is zero', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.bet(web3.toWei('50', 'finney'));
		await testCase.setArbiterAddress();

		await this.inst.IsArbiterAddressConfirmed({from: acc.anyone}).should.eventually.be.false;
		await this.inst.ArbiterPenaltyAmount({from: acc.anyone}).should.eventually.be.bignumber.equal(0);
		const agreedStateVersion = await this.inst.StateVersion();

		await this.inst.agreeToBecameArbiter(agreedStateVersion, {from: acc.arbiter, value: 0}).should.eventually.be.fulfilled;
		await this.inst.IsArbiterAddressConfirmed({from: acc.anyone}).should.eventually.be.true;
	});

	it('should not allow arbiter candidate to became an arbiter if sent to much or to few ether', async function() {
		const penaltyAmount = web3.toWei('30', 'finney');
		const insufficientAmount = web3.toWei('29.99', 'finney');
		const exceedingAmount = web3.toWei('30.01', 'finney');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.bet(web3.toWei('50', 'finney'));
		await testCase.setArbiterPenaltyAmount(penaltyAmount);
		await testCase.setArbiterAddress();

		const agreedStateVersion = await this.inst.StateVersion();
		await expectThrow(this.inst.agreeToBecameArbiter(agreedStateVersion, {from: acc.arbiter, value: insufficientAmount}));
		await expectThrow(this.inst.agreeToBecameArbiter(agreedStateVersion, {from: acc.arbiter, value: exceedingAmount}));
		// Ensure agreedStateVersion was not the reason of revert
		await this.inst.agreeToBecameArbiter(agreedStateVersion, {from: acc.arbiter, value: penaltyAmount}).should.eventually.be.fulfilled;
	});

	it('should not allow to became an arbiter if state has changed', async function() {
		const penaltyAmount = web3.toWei('0.03');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.bet(web3.toWei('0.05'));
		await testCase.setArbiterPenaltyAmount(penaltyAmount);
		await testCase.setArbiterAddress();

		const agreedStateVersion = await this.inst.StateVersion();
		await testCase.setArbiterPenaltyAmount(web3.toWei('0')); // Modify state

		await expectThrow(this.inst.agreeToBecameArbiter(agreedStateVersion, {from: acc.arbiter, value: penaltyAmount}));
	});

	it('should not allow arbiter candidate to became an arbiter twice', async function() {
		const penaltyAmount = web3.toWei('30', 'finney');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.bet();
		await testCase.setArbiterPenaltyAmount(penaltyAmount);
		await testCase.setArbiterAddress();
		await testCase.agreeToBecameArbiter();

		const agreedStateVersion = await this.inst.StateVersion();
		await expectThrow(this.inst.agreeToBecameArbiter(agreedStateVersion, {from: acc.arbiter, value: penaltyAmount}));
	});

	it('should not allow to change arbiter address after arbiter is confirmed', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();

		await expectThrow(this.inst.setArbiterAddress(acc.anyone, {from: acc.owner}));
	});

	it('should not allow to change arbiter penalty amount after arbiter is confirmed', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();

		const newPenaltyAmount = (await this.inst.ArbiterPenaltyAmount()) + 1;
		await expectThrow(this.inst.setArbiterPenaltyAmount(newPenaltyAmount, {from: acc.owner}));
	});

	it('should not allow to change arbiter fee percent after arbiter is confirmed', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();

		const fee = web3.toWei('10.0'); // 10%
		await expectThrow(this.inst.setArbiterFee(fee, {from: acc.owner}));
	});

	it('should not allow to change deadline after arbiter is agreed', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();
		const newValue = daysInFutureTimestamp(15);
		await expectThrow(this.inst.setDeadline(newValue, {from: acc.owner}));
	});

	it('should not allow to change assertion text after arbiter is agreed', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();
		await expectThrow(this.inst.setAssertionText("some unique assertion text", {from: acc.owner}));
	});

	it('should not allow non-arbiter to call arbiterSelfRetreat', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();
		await expectThrow(this.inst.arbiterSelfRetreat({from: acc.anyone}));
	});

	it('should not allow owner to call arbiterSelfRetreat', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();
		await expectThrow(this.inst.arbiterSelfRetreat({from: acc.owner}));
	});

	it('should allow arbiter to retreat before opponent accepted bet and take penalty amount back', async function() {
		const penaltyAmount = web3.toWei('40', 'finney');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree({penaltyAmount});

		const gasPrice = 10;
		const arbiterRetreatCallInfo = {func: this.inst.arbiterSelfRetreat, args: [], address: acc.arbiter, gasPrice};
		await assertBalanceDiff(arbiterRetreatCallInfo, penaltyAmount);
		await this.inst.IsArbiterAddressConfirmed({from: acc.anyone}).should.be.eventually.false;
	});

	it('should allow arbiter to accept/retreat twice', async function() {
		const penaltyAmount = web3.toWei('40', 'finney');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree({penaltyAmount});

		await this.inst.arbiterSelfRetreat({from:acc.arbiter}).should.be.eventually.fulfilled;
		await this.inst.IsArbiterAddressConfirmed({from: acc.anyone}).should.be.eventually.false;
		await this.inst.ArbiterPenaltyAmount({from: acc.anyone}).should.be.eventually.bignumber.equal(penaltyAmount);
		await testCase.agreeToBecameArbiter();
		await this.inst.IsArbiterAddressConfirmed({from: acc.anyone}).should.be.eventually.true;
		await this.inst.arbiterSelfRetreat({from:acc.arbiter}).should.be.eventually.fulfilled;
		await this.inst.IsArbiterAddressConfirmed({from: acc.anyone}).should.be.eventually.false;
	});

	it('should allow arbiter to retreat in case where penalty amount is not set(zero)', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree({setPenaltyAmount: false});

		const gasPrice = 10;
		const arbiterRetreatCallInfo = {func: this.inst.arbiterSelfRetreat, args: [], address: acc.arbiter, gasPrice};
		await assertBalanceDiff(arbiterRetreatCallInfo, web3.toWei('0'));
	});

	it('should not allow to retreat before agreed', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.bet();
		await testCase.setArbiterAddress();
		await testCase.setArbiterPenaltyAmount();

		await expectThrow(this.inst.arbiterSelfRetreat({from: acc.arbiter}));
	});

	it('should revert if unable to transfer ether to arbiter address', async function() {
		// Prepare to test
		const arbiter = await UnpayableArbiter.new(this.inst.address, {from: acc.owner});
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.bet(web3.toWei('0.5'));
		await testCase.setArbiterAddress(arbiter.address);
		const penaltyAmount = web3.toWei('0.003');
		await testCase.setArbiterPenaltyAmount(penaltyAmount);
		await arbiter.agreeToBecameArbiter({from: acc.anyone, value: penaltyAmount}).should.eventually.be.fulfilled;
		// Test
		await expectThrow(arbiter.arbiterSelfRetreat({from: acc.arbiter}));
	});
});

contract('BetMe - choosing opponent', function(accounts) {
	const acc = {anyone: accounts[0], owner: accounts[1], opponent: accounts[2], arbiter: accounts[3]};

	beforeEach(async function () {
		this.inst = await BetMe.new(...constructorArgs(), {from: acc.owner},);
	});

	it('should allow owner to set opponent address even after arbiter is choosen', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();
		await this.inst.setOpponentAddress(acc.opponent, {from: acc.owner}).should.be.eventually.fulfilled;
	});

	it('should allow anyone to became an opponent if owner not specified its address', async function() {
		const betAmount = web3.toWei('100', 'finney');
		const testCase = newBetCase(this.inst, acc, {betAmount});
		await testCase.preconditionArbiterIsChoosenAndAgree();

		const agreedStateVersion = await this.inst.StateVersion();
		await this.inst.IsOpponentBetConfirmed({from: acc.anyone}).should.be.eventually.false;
		await this.inst.betAssertIsFalse(agreedStateVersion, {from: acc.anyone, value: betAmount}).should.be.eventually.fulfilled;
		await this.inst.IsOpponentBetConfirmed({from: acc.anyone}).should.be.eventually.true;
		await this.inst.OpponentAddress({from: acc.anyone}).should.be.eventually.equal(acc.anyone);
	});

	it('should not bet if opponent did not sent any ether or sent to much or to few', async function() {
		const betAmount = web3.toWei('100', 'finney');
		const insufficientAmount = (new BigNumber(betAmount))-1;
		const exceedingAmount = (new BigNumber(betAmount))+1;
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree({betAmount});
		const agreedStateVersion = await this.inst.StateVersion();
		await expectThrow(this.inst.betAssertIsFalse(agreedStateVersion, {from: acc.owner}));
		await expectThrow(this.inst.betAssertIsFalse(agreedStateVersion, {from: acc.owner, value: insufficientAmount}));
		await expectThrow(this.inst.betAssertIsFalse(agreedStateVersion, {from: acc.owner, value: exceedingAmount}));
	});

	it('should not bet if opponent sent wrong state version number', async function() {
		const betAmount = web3.toWei('0.001');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree({betAmount});
		const agreedStateVersion = await this.inst.StateVersion();
		await testCase.setOpponentAddress(); // This changes state version

		await expectThrow(this.inst.betAssertIsFalse(agreedStateVersion, {from: acc.opponent, value: betAmount}));
	});

	it('should not allow opponent bet before owner bet', async function() {
		const agreedStateVersion = await this.inst.StateVersion();
		await expectThrow(this.inst.betAssertIsFalse(agreedStateVersion, {from: acc.owner, value: 0}));
	});

	it('should not allow opponent bet before arbiter is choosen and agreed', async function() {
		const betAmount = web3.toWei('50', 'finney');
		const penaltyAmount = web3.toWei('10', 'finney');
		const testCase = newBetCase(this.inst, acc, {betAmount, penaltyAmount});
		await testCase.bet();
		await testCase.setArbiterAddress();
		await testCase.setArbiterPenaltyAmount();
		await testCase.setArbiterFee();

		const agreedStateVersion = await this.inst.StateVersion();
		await expectThrow(this.inst.betAssertIsFalse(agreedStateVersion, {from: acc.opponent, value: betAmount}));
	});

	it('should allow predefined opponent to bet', async function() {
		const betAmount = web3.toWei('100', 'finney');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree({betAmount});
		await testCase.setOpponentAddress();
		await this.inst.OpponentAddress({from: acc.anyone}).should.be.eventually.equal(acc.opponent);
		const agreedStateVersion = await this.inst.StateVersion();

		await this.inst.betAssertIsFalse(agreedStateVersion, {from: acc.opponent, value: betAmount}).should.be.eventually.fulfilled;
		await this.inst.IsOpponentBetConfirmed({from: acc.anyone}).should.be.eventually.true;
		await this.inst.OpponentAddress({from: acc.anyone}).should.be.eventually.equal(acc.opponent);
	});

	it('should not allow anyone else to bet if have predefined opponent', async function() {
		const betAmount = web3.toWei('0.001');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree({betAmount});
		await testCase.setOpponentAddress();
		const agreedStateVersion = await this.inst.StateVersion();

		await expectThrow(this.inst.betAssertIsFalse(agreedStateVersion, {from: acc.anyone, value: betAmount}));
	});

	it('should not allow owner to bet as opponent', async function() {
		const betAmount = web3.toWei('0.001');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree({betAmount});
		const agreedStateVersion = await this.inst.StateVersion();
		await this.inst.IsOpponentBetConfirmed({from: acc.anyone}).should.be.eventually.false;

		await expectThrow(this.inst.betAssertIsFalse(agreedStateVersion, {from: acc.owner, value: betAmount}));
	});

	it('should not allow arbiter to bet as opponent', async function() {
		const betAmount = web3.toWei('0.001');
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree({betAmount});
		const agreedStateVersion = await this.inst.StateVersion();

		await expectThrow(this.inst.betAssertIsFalse(agreedStateVersion, {from: acc.arbiter, value: betAmount}));
	});

	it('should not allow change opponent address after bet is made', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await expectThrow(this.inst.setOpponentAddress(acc.anyone, {from: acc.owner}));
	});

	it('should not allow change arbiter address after bet is made', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await expectThrow(this.inst.setArbiterAddress(acc.anyone, {from: acc.owner}));
	});

	it('should not allow opponent bet twice', async function() {
		const betAmount = web3.toWei('50', 'finney');
		const testCase = newBetCase(this.inst, acc, {betAmount});
		await testCase.preconditionOpponentBetIsMade();

		const agreedStateVersion = await this.inst.StateVersion();
		await expectThrow(this.inst.betAssertIsFalse(agreedStateVersion, {from: acc.opponent, value: betAmount}));
	});

	it('should not allow arbiter to retreat after opponent bet is made', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await expectThrow(this.inst.arbiterSelfRetreat({from: acc.arbiter}));
	});

	it('should not allow to change deadline after oponnet bet is made', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		const newValue = daysInFutureTimestamp(15);
		await expectThrow(this.inst.setDeadline(newValue, {from: acc.owner}));
	});

	it('should not allow to change assertion text after opponent bet is made', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await expectThrow(this.inst.setAssertionText("some unique assertion text", {from: acc.owner}));
	});
});


contract('BetMe - payout helpers', function(accounts) {
	const acc = {anyone: accounts[0], owner: accounts[1], opponent: accounts[2], arbiter: accounts[3]};

	beforeEach(async function () {
		this.inst = await BetMe.new(...constructorArgs(), {from: acc.owner},);
	});

	it('should return zero as owner payout before he made his bet', async function() {
		await this.inst.ownerPayout({from: acc.owner}).should.eventually.be.bignumber.zero;
	});

	it('should return zero as arbiter payout before arbiter fee is set', async function() {
		await this.inst.arbiterPayout({from: acc.owner}).should.eventually.be.bignumber.zero;
	});

	it('should be zero arbiter payout before owner bet is made', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.setArbiterFee(web3.toWei('10.0')); // %
		await this.inst.arbiterPayout({from: acc.owner}).should.eventually.be.bignumber.zero;
	});

	it('should be arbiter payout OWNER_BET * ARBITER_FEE% / 100 after arbiter fee and owner bet is set', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.setArbiterFee(web3.toWei('10.0'));
		await testCase.bet(web3.toWei('55', 'finney'));

		const gotAmount = await this.inst.arbiterPayout({from: acc.owner});
		const wantAmount = web3.toWei('5.5', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('should not add arbiter penalty amount to payout amount until arbiter sent ether', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.setArbiterFee(web3.toWei('10.0')); // %
		await testCase.setArbiterAddress();
		await testCase.bet(web3.toWei('55', 'finney'));
		await testCase.setArbiterPenaltyAmount(web3.toWei('15', 'finney'));

		const gotAmount = await this.inst.arbiterPayout({from: acc.owner});
		const wantAmount = web3.toWei('5.5', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('should add arbiter penalty amount to payout amount after arbiter agreed and sent ether', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();

		const gotAmount = await this.inst.arbiterPayout({from: acc.owner});
		const wantAmount = web3.toWei('25.5', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('should add arbiter penalty amount to payout amount after arbiter voted assertion is true', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionTrue();

		const gotAmount = await this.inst.arbiterPayout({from: acc.owner});
		const wantAmount = web3.toWei('25.5', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('should add arbiter penalty amount to payout amount after arbiter voted assertion is false', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionFalse();

		const gotAmount = await this.inst.arbiterPayout({from: acc.owner});
		const wantAmount = web3.toWei('25.5', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('should not add arbiter fee to payout amount after arbiter voted assertion is unresolvable', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionUnresolvable();

		const gotAmount = await this.inst.arbiterPayout({from: acc.owner});
		const wantAmount = web3.toWei('20', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('should not pay arbiter abything if he does not voted before deadline', async function() {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.setTimeAfterDeadline();

		await this.inst.arbiterPayout({from: acc.anyone}).should.eventually.be.bignumber.equal(web3.toWei('0', 'finney'));
	});

	it('should pay arbiter full amount after deadline if he voted for true before deadline', async function() {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionTrue();
		await testCase.setTimeAfterDeadline();

		const gotAmount = await this.inst.arbiterPayout({from: acc.anyone});
		const wantAmount = web3.toWei('25.5', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('should pay arbiter full amount after deadline if he voted for false before deadline', async function() {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionFalse();
		await testCase.setTimeAfterDeadline();

		const gotAmount = await this.inst.arbiterPayout({from: acc.anyone});
		const wantAmount = web3.toWei('25.5', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('should return an arbiter penalty amount after deadline if he voted for unresolvable before deadline', async function() {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionUnresolvable();
		await testCase.setTimeAfterDeadline();

		const gotAmount = await this.inst.arbiterPayout({from: acc.anyone});
		const wantAmount = web3.toWei('20', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});


	it('should return zero from ownerPayout before bet', async function() {
		await this.inst.ownerPayout({from: acc.owner}).should.eventually.be.bignumber.zero;
	});

	it('ownerPayout should return bet amount as owner payout just after his bet', async function() {
		const betAmount = web3.toWei('50', 'finney');
		await this.inst.bet({from: acc.owner, value: betAmount});
		await this.inst.ownerPayout({from: acc.owner}).should.eventually.be.bignumber.equal(betAmount);
	});

	it('ownerPayout should be equal to bet amount after arbiter agreed', async function() {
		const testCase = newBetCase(this.inst, acc, {betAmount: web3.toWei('50', 'finney')});
		await testCase.setArbiterFee(web3.toWei('10.0'));
		await testCase.setArbiterAddress();
		await testCase.bet();
		await testCase.setArbiterPenaltyAmount(web3.toWei('20', 'finney'));
		await testCase.agreeToBecameArbiter();

		const gotAmount = await this.inst.ownerPayout({from: acc.anyone});
		const wantAmount = testCase.opt.betAmount;
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('ownerPayout should be equal to bet amount after opponent bet if arbiter fee is zero', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();

		const gotAmount = await this.inst.ownerPayout({from: acc.anyone});
		const wantAmount = testCase.opt.betAmount;
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('ownerPayout should be equal to bet amount after opponent bet if arbiter fee is non-zero', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();

		const gotAmount = await this.inst.ownerPayout({from: acc.anyone});
		const wantAmount = web3.toWei('55', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('ownerPayout should be double bet amount minus arbiter fee after arbiter voted for true', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionTrue();

		const gotAmount = await this.inst.ownerPayout({from: acc.anyone});
		const wantAmount = web3.toWei('104.5', 'finney'); // 55 * 2 - (55 * 10.0%)
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('ownerPayout should be zero after arbiter voted for false', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionFalse();

		const gotAmount = await this.inst.ownerPayout({from: acc.anyone});
		const wantAmount = web3.toWei('0', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('ownerPayout should be equal to bet amount after arbiter voted for unresolvable', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionUnresolvable();

		const gotAmount = await this.inst.ownerPayout({from: acc.anyone});
		const wantAmount = testCase.opt.betAmount;
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('ownerPayout should return full bet amount if arbiter failed to vote before deadline but penalty iz zero', async function() {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
		});
		await testCase.preconditionOpponentBetIsMade({setPenaltyAmount: false});
		await testCase.setTimeAfterDeadline();
		await this.inst.ArbiterPenaltyAmount({from: acc.anyone}).should.eventually.be.bignumber.equal(0);

		const gotAmount = await this.inst.ownerPayout({from: acc.anyone});
		const wantAmount = web3.toWei('55', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('ownerPayout should return full bet amount + half penalty amount if arbiter failed to vote before deadline', async function() {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.setTimeAfterDeadline();

		const gotAmount = await this.inst.ownerPayout({from: acc.anyone});
		const wantAmount = web3.toWei('65', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('ownerPayout should return full bet amount after deadline if no arbiter and opponent been set', async function() {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
		const testCase = newBetCase(this.inst, acc, {betAmount: web3.toWei('0.001')});
		await testCase.bet();
		await testCase.setTimeAfterDeadline();

		const gotAmount = await this.inst.ownerPayout({from: acc.anyone});
		const wantAmount = testCase.opt.betAmount;
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('opponentPayout should return zero before opponent address is set', async function() {
		await this.inst.opponentPayout({from: acc.anyone}).should.eventually.be.bignumber.zero;
	});

	it('opponentPayout should return zero before owner bet', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.setOpponentAddress();
		await this.inst.opponentPayout({from: acc.anyone}).should.eventually.be.bignumber.zero;
	});

	it('opponentPayout should return zero after owner bet but before arbiter agreed', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.setArbiterAddress();
		await testCase.bet();
		await this.inst.opponentPayout({from: acc.anyone}).should.eventually.be.bignumber.zero;
	});

	it('opponentPayout should return zero before opponent bet', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();
		await this.inst.opponentPayout({from: acc.anyone}).should.eventually.be.bignumber.zero;
	});

	it('opponentPayout should return betAmount after opponent bet', async function() {
		const betAmount = web3.toWei('2', 'finney')
		const testCase = newBetCase(this.inst, acc, {betAmount});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.opponentPayout({from: acc.anyone}).should.eventually.be.bignumber.equal(betAmount);
	});

	it('opponentPayout should return zero after arbiter voted for true', async function() {
		const betAmount = web3.toWei('2', 'finney')
		const testCase = newBetCase(this.inst, acc, {betAmount});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionTrue();
		await this.inst.opponentPayout({from: acc.anyone}).should.eventually.be.bignumber.equal(web3.toWei('0', 'finney'));
	});

	it('opponentPayout should return zero after arbiter voted for false', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionFalse();

		const gotAmount = await this.inst.opponentPayout({from: acc.anyone});
		const wantAmount = web3.toWei('104.5', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('opponentPayout should return betAmount after arbiter voted for unresolvable', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionUnresolvable();

		const gotAmount = await this.inst.opponentPayout({from: acc.anyone});
		const wantAmount = web3.toWei('55', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('opponentPayout should return full bet amount if arbiter failed to vote before deadline but penalty amount is zero', async function() {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
		});
		await testCase.preconditionOpponentBetIsMade({setPenaltyAmount: false});
		await this.inst.ArbiterPenaltyAmount({from: acc.anyone}).should.eventually.be.bignumber.equal(0);
		await testCase.setTimeAfterDeadline();

		const gotAmount = await this.inst.opponentPayout({from: acc.anyone});
		const wantAmount = web3.toWei('55', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

	it('opponentPayout should return full bet amount + half penalty amount if arbiter failed to vote before deadline', async function() {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.setTimeAfterDeadline();

		const gotAmount = await this.inst.opponentPayout({from: acc.anyone});
		const wantAmount = web3.toWei('65', 'finney');
		gotAmount.should.be.bignumber.equal(wantAmount);
	});

});

contract('BetMe - bet resolve', function(accounts) {
	const acc = {anyone: accounts[0], owner: accounts[1], opponent: accounts[2], arbiter: accounts[3]};

	beforeEach(async function () {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
	});

	it('should allow an arbiter to deside assertion is true', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.ArbiterHasVoted({from: acc.arbiter}).should.be.eventually.false;
		await this.inst.agreeAssertionTrue({from: acc.arbiter}).should.be.eventually.fulfilled;
		await this.inst.ArbiterHasVoted({from: acc.arbiter}).should.be.eventually.true;
	});

	it('should flag that decision is made after call to agreeAssertionTrue', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.IsDecisionMade({from: acc.arbiter}).should.be.eventually.false;
		await this.inst.agreeAssertionTrue({from: acc.arbiter}).should.be.eventually.fulfilled;
		await this.inst.IsDecisionMade({from: acc.arbiter}).should.be.eventually.true;
	});

	it('should flag that assertion is considered true after call to agreeAssertionTrue', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.IsAssertionTrue({from: acc.arbiter}).should.be.eventually.false;
		await this.inst.agreeAssertionTrue({from: acc.arbiter}).should.be.eventually.fulfilled;
		await this.inst.IsAssertionTrue({from: acc.arbiter}).should.be.eventually.true;
	});

	it('should not allow owner, opponent, or anyone to call agreeAssertionTrue', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await expectThrow(this.inst.agreeAssertionTrue({from: acc.owner}));
		await expectThrow(this.inst.agreeAssertionTrue({from: acc.opponent}));
		await expectThrow(this.inst.agreeAssertionTrue({from: acc.anyone}));
	});

	it('should not allow an arbiter to deside assertion is true unless opponent made his bet', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();
		await expectThrow(this.inst.agreeAssertionTrue({from: acc.arbiter}));
	});

	it('should allow an arbiter to deside assertion is false', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.ArbiterHasVoted({from: acc.arbiter}).should.be.eventually.false;
		await this.inst.agreeAssertionFalse({from: acc.arbiter}).should.be.eventually.fulfilled;
		await this.inst.ArbiterHasVoted({from: acc.arbiter}).should.be.eventually.true;
	});

	it('should flag that decision is made after call to agreeAssertionFalse', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.IsDecisionMade({from: acc.arbiter}).should.be.eventually.false;
		await this.inst.agreeAssertionFalse({from: acc.arbiter}).should.be.eventually.fulfilled;
		await this.inst.IsDecisionMade({from: acc.arbiter}).should.be.eventually.true;
	});

	it('should flag that assertion is considered false before and after call to agreeAssertionFalse', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.IsAssertionTrue({from: acc.arbiter}).should.be.eventually.false;
		await this.inst.agreeAssertionFalse({from: acc.arbiter}).should.be.eventually.fulfilled;
		await this.inst.IsAssertionTrue({from: acc.arbiter}).should.be.eventually.false;
	});

	it('should not allow owner, opponent, or anyone else to call agreeAssertionFalse', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await expectThrow(this.inst.agreeAssertionFalse({from: acc.owner}));
		await expectThrow(this.inst.agreeAssertionFalse({from: acc.opponent}));
		await expectThrow(this.inst.agreeAssertionFalse({from: acc.anyone}));
	});

	it('should not allow an arbiter to call agreeAssertionFalse unless opponent made his bet', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();
		await expectThrow(this.inst.agreeAssertionFalse({from: acc.arbiter}));
	});

	it('should not allow an arbiter to call agreeAssertionFalse twice', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.agreeAssertionFalse({from: acc.arbiter}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.agreeAssertionFalse({from: acc.arbiter}));
		await expectThrow(this.inst.agreeAssertionFalse({from: acc.arbiter})); // or triple
	});

	it('should not allow an arbiter to call agreeAssertionTrue twice', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.agreeAssertionTrue({from: acc.arbiter}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.agreeAssertionTrue({from: acc.arbiter}));
		await expectThrow(this.inst.agreeAssertionTrue({from: acc.arbiter})); // or triple
	});

	it('should not allow an arbiter to call agreeAssertionTrue after agreeAssertionFalse', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.agreeAssertionFalse({from: acc.arbiter}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.agreeAssertionTrue({from: acc.arbiter}));
	});

	it('should not allow an arbiter to call agreeAssertionFalse after agreeAssertionTrue', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.agreeAssertionTrue({from: acc.arbiter}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.agreeAssertionFalse({from: acc.arbiter}));
	});

	it('should allow an arbiter to deside assertion is unresolvable', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.ArbiterHasVoted({from: acc.arbiter}).should.be.eventually.false;
		await this.inst.agreeAssertionUnresolvable({from: acc.arbiter}).should.be.eventually.fulfilled;
		await this.inst.ArbiterHasVoted({from: acc.arbiter}).should.be.eventually.true;
	});

	it('should flag decision is not made if arbiter voted with agreeAssertionUnresolvable', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.agreeAssertionUnresolvable({from: acc.arbiter}).should.be.eventually.fulfilled;
		await this.inst.IsDecisionMade({from: acc.arbiter}).should.be.eventually.false;
		await this.inst.IsAssertionTrue({from: acc.arbiter}).should.be.eventually.false;
	});

	it('should not allow owner, opponent, or anyone to call agreeAssertionUnresolvable', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await expectThrow(this.inst.agreeAssertionUnresolvable({from: acc.owner}));
		await expectThrow(this.inst.agreeAssertionUnresolvable({from: acc.opponent}));
		await expectThrow(this.inst.agreeAssertionUnresolvable({from: acc.anyone}));
	});

	it('should not allow to call agreeAssertionUnresolvable twice', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.agreeAssertionUnresolvable({from: acc.arbiter}).should.be.eventually.fulfilled;
		await expectThrow(this.inst.agreeAssertionUnresolvable({from: acc.arbiter}));
	});

	it('should not allow to call agreeAssertionUnresolvable unless opponent made his bet', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();
		await expectThrow(this.inst.agreeAssertionUnresolvable({from: acc.arbiter}));
	});

	it('should not allow an arbiter to vote true after deadline', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		const newTime = (await this.inst.Deadline()).add(3600);
		await this.inst.setTime(newTime, {from: acc.owner}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.agreeAssertionTrue({from: acc.arbiter}));
	});

	it('should not allow an arbiter to vote false after deadline', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		const newTime = (await this.inst.Deadline()).add(3600);
		await this.inst.setTime(newTime, {from: acc.owner}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.agreeAssertionFalse({from: acc.arbiter}));
	});

	it('should not allow an arbiter to vote unresolvable after deadline', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		const newTime = (await this.inst.Deadline()).add(3600);
		await this.inst.setTime(newTime, {from: acc.owner}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.agreeAssertionUnresolvable({from: acc.arbiter}));
	});

	it('should not allow an arbiter to call agreeAssertionUnresolvable after agreeAssertionTrue', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.agreeAssertionTrue({from: acc.arbiter}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.agreeAssertionUnresolvable({from: acc.arbiter}));
	});

	it('should not allow an arbiter to call agreeAssertionTrue after agreeAssertionUnresolvable', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.agreeAssertionUnresolvable({from: acc.arbiter}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.agreeAssertionTrue({from: acc.arbiter}));
	});

	it('should not allow an arbiter to call agreeAssertionUnresolvable after agreeAssertionFalse', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.agreeAssertionFalse({from: acc.arbiter}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.agreeAssertionUnresolvable({from: acc.arbiter}));
	});

	it('should not allow an arbiter to call agreeAssertionFalse after agreeAssertionUnresolvable', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.agreeAssertionUnresolvable({from: acc.arbiter}).should.eventually.be.fulfilled;
		await expectThrow(this.inst.agreeAssertionFalse({from: acc.arbiter}));
	});
});

contract('BetMe - withdrawal', function(accounts) {
	const acc = {anyone: accounts[0], owner: accounts[1], opponent: accounts[2], arbiter: accounts[3]};

	beforeEach(async function () {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
	});

	it('should let arbiter to withdraw penalty amount + fee after successful agreeAssertionTrue', async function() {
		const gasPrice = 10;
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionTrue();

		const callInfo = {func: this.inst.withdraw, args: [], address: acc.arbiter, gasPrice};
		const wantAmount = web3.toWei('25.5', 'finney');
		await assertBalanceDiff(callInfo, wantAmount);
	});

	it('should not let arbiter to withdraw before he voted', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await expectThrow(this.inst.withdraw({from: acc.arbiter}));
	});

	it('should let owner to withdraw double bet amount (minus arbiter fee) after successful agreeAssertionTrue', async function() {
		const gasPrice = 10;
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionTrue();

		const callInfo = {func: this.inst.withdraw, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = web3.toWei('104.5', 'finney'); // opponent_bet + owner_bet - (arbiter_fee) = 110 - 5.5
		await assertBalanceDiff(callInfo, wantWithdrawalAmount);
	});

	it('should let owner to withdraw bet amount after successful agreeAssertionUnresolvable', async function() {
		const gasPrice = 10;
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionUnresolvable();

		const callInfo = {func: this.inst.withdraw, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = testCase.opt.betAmount;
		await assertBalanceDiff(callInfo, wantWithdrawalAmount);
	});

	it('should let owner to withdraw bet amount + half of penalty amount if arbiter did not voted before deadline', async function() {
		const gasPrice = 10;
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.setTimeAfterDeadline();

		const callInfo = {func: this.inst.withdraw, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = web3.toWei('65', 'finney');
		await assertBalanceDiff(callInfo, wantWithdrawalAmount);
	});

	it('should not let owner to withdraw before arbiter voted', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await expectThrow(this.inst.withdraw({from: acc.owner}));
	});

	it('should not allow owner to withdraw twice', async function() {
		const betAmount = web3.toWei('10', 'finney');
		const penaltyAmount = web3.toWei('100','finney');
		penaltyAmount.should.be.bignumber.above((new BigNumber(betAmount)).mul(6), 'owner withdraw will not revert due to insufficient funds');
		const testCase = newBetCase(this.inst, acc, {betAmount, penaltyAmount});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionTrue();

		await this.inst.withdraw({from: acc.owner}).should.be.eventually.fulfilled;
		await expectThrow(this.inst.withdraw({from: acc.owner}));
		await expectThrow(this.inst.withdraw({from: acc.owner})); // we test same call twice 
	});

	it('should not allow arbiter to withdraw twice', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionTrue();

		await this.inst.withdraw({from: acc.arbiter}).should.be.eventually.fulfilled;
		await expectThrow(this.inst.withdraw({from: acc.arbiter}));
		await expectThrow(this.inst.withdraw({from: acc.arbiter})); // we test same call twice 
	});

	it('should not allow an opponent to withdraw if assertion considered true', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionTrue();
		await expectThrow(this.inst.withdraw({from: acc.opponent}));
	});

	it('should not allow owner to withdraw if assertion considered false', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await this.inst.agreeAssertionFalse({from: acc.arbiter}).should.be.eventually.fulfilled;
		await expectThrow(this.inst.withdraw({from: acc.owner}));
	});

	it('should not allow opponent to withdraw just after bet', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await expectThrow(this.inst.withdraw({from: acc.opponent}));
	});

	it('should allow opponent to withdraw double bet amount minus arbiter fee after vote for false', async function() {
		const gasPrice = 10;
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionFalse();

		const callInfo = {func: this.inst.withdraw, args: [], address: acc.opponent, gasPrice};
		const wantWithdrawalAmount = web3.toWei('104.5','finney');
		await assertBalanceDiff(callInfo, wantWithdrawalAmount);
	});

	it('should not allow opponent to withdraw twice', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionFalse();
		await this.inst.sendTransaction({from: acc.owner, value: web3.toWei('200', 'finney')});

		await this.inst.withdraw({from: acc.opponent}).should.be.eventually.fulfilled;
		await expectThrow(this.inst.withdraw({from: acc.opponent}));
		await expectThrow(this.inst.withdraw({from: acc.opponent})); // or triple
	});

	it('should let opponent to withdraw bet amount after successful agreeAssertionUnresolvable', async function() {
		const gasPrice = 10;
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionUnresolvable();

		const callInfo = {func: this.inst.withdraw, args: [], address: acc.opponent, gasPrice};
		const wantWithdrawalAmount = testCase.opt.betAmount;
		await assertBalanceDiff(callInfo, wantWithdrawalAmount);
	});

	it('should let opponent to withdraw bet amount + half of penalty amount if arbiter did not voted before deadline', async function() {
		const gasPrice = 10;
		const testCase = newBetCase(this.inst, acc, {
			betAmount:     web3.toWei('55', 'finney'),
			feePercent:    web3.toWei('10.0'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.setTimeAfterDeadline();

		const callInfo = {func: this.inst.withdraw, args: [], address: acc.opponent, gasPrice};
		const wantWithdrawalAmount = web3.toWei('65', 'finney');
		await assertBalanceDiff(callInfo, wantWithdrawalAmount);
	});

});

contract('BetMe - contractDelete', function(accounts) {
	const acc = {anyone: accounts[0], owner: accounts[1], opponent: accounts[2], arbiter: accounts[3]};

	beforeEach(async function () {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
	});

	const gasPrice = 10;

	it('should revert if deleteContract called by non-owner at init stage', async function() {
		const testCase = newBetCase(this.inst, acc, {});

		await expectThrow(this.inst.deleteContract({from: acc.anyone}));
		await expectThrow(this.inst.deleteContract({from: acc.arbiter}));
		await expectThrow(this.inst.deleteContract({from: acc.opponent}));
	});

	it('should revert if deleteContract called by non-owner while opponent choose stage', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();

		await expectThrow(this.inst.deleteContract({from: acc.anyone}));
		await expectThrow(this.inst.deleteContract({from: acc.arbiter}));
		await expectThrow(this.inst.deleteContract({from: acc.opponent}));
	});

	it('should selfdestruct after successful call to deleteContract at init phase', async function() {
		await this.inst.deleteContract({from: acc.owner}).should.be.eventually.fulfilled;
		await expectNoContract(this.inst.OwnerAddress({from: acc.anyone}));
	});

	it('should selfdestruct after successful call to deleteContract at opponent choose phase', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionArbiterIsChoosenAndAgree();
		await this.inst.deleteContract({from: acc.owner}).should.be.eventually.fulfilled;
		
		await expectNoContract(this.inst.OwnerAddress({from: acc.anyone}));
	});

	it('should destroy contract and return bet to owner after call to deleteContract before arbiter agreed', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.bet(web3.toWei('50', 'finney'));

		const expectedBalanceDiff = {[acc.arbiter]: 0, [acc.opponent]: 0,};
		const callInfo = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = testCase.opt.betAmount;

		await assertBalanceDiff(callInfo, wantWithdrawalAmount, expectedBalanceDiff);
		await expectNoContract(this.inst.OwnerAddress({from: acc.anyone}));
	});

	it('deleteContract should transfer bet amount to owner if arbiter confirmed but no opponent and fee == penalty == 0', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount: web3.toWei('50', 'finney'),
			feePercent: web3.toWei('0'),
		});
		await testCase.preconditionArbiterIsChoosenAndAgree({setPenaltyAmount: false});

		const expectedBalanceDiff = {
			[acc.arbiter]:  0,
			[acc.opponent]: 0, 
		};
		const callInfo = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = testCase.opt.betAmount;
		await assertBalanceDiff(callInfo, wantWithdrawalAmount, expectedBalanceDiff);
	});

	it('deleteContract should return penalty amount to arbiter and transfer rest to owner if arbiter confirmed but no opponent', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount: web3.toWei('50', 'finney'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionArbiterIsChoosenAndAgree();

		const expectedBalanceDiff = {
			[acc.arbiter]:  testCase.opt.penaltyAmount,
			[acc.opponent]: 0, 
		};
		const callInfo = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = testCase.opt.betAmount;
		await assertBalanceDiff(callInfo, wantWithdrawalAmount, expectedBalanceDiff);
	});

	it('deleteContract should return arbiterPayout to arbiter and transfer rest to owner if vote for true', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount: web3.toWei('50', 'finney'),
			feePercent: web3.toWei('10'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionTrue();

		const expectedBalanceDiff = {
			[acc.arbiter]:  web3.toWei('25', 'finney'),
			[acc.opponent]: 0, 
		};
		const callInfo = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = web3.toWei('95', 'finney');
		await assertBalanceDiff(callInfo, wantWithdrawalAmount, expectedBalanceDiff);
	});

	it('deleteContract should return arbiter fee amount to arbiter and transfer rest to owner if vote for true and penalty amount is zero', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount: web3.toWei('50', 'finney'),
			feePercent: web3.toWei('10'),
		});
		await testCase.preconditionOpponentBetIsMade({setPenaltyAmount: false});
		await testCase.agreeAssertionTrue();

		const expectedBalanceDiff = {
			[acc.arbiter]:  web3.toWei('5', 'finney'),
			[acc.opponent]: 0, 
		};
		const callInfo = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = web3.toWei('95', 'finney');
		await assertBalanceDiff(callInfo, wantWithdrawalAmount, expectedBalanceDiff);
	});

	it('deleteContract should return arbiterPayout to arbiter if vote for false and opponent took his money', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount: web3.toWei('50', 'finney'),
			feePercent: web3.toWei('10'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionFalse();
		await this.inst.withdraw({from: acc.opponent}).should.be.eventually.fulfilled;

		const expectedBalanceDiff = {
			[acc.arbiter]:  web3.toWei('25', 'finney'),
			[acc.opponent]: 0, 
		};
		const callInfo = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = web3.toWei('0', 'finney');
		await assertBalanceDiff(callInfo, wantWithdrawalAmount, expectedBalanceDiff);
	});

	it('deleteContract should return arbiter penalty to arbiter if vote for unresolvable and opponent took his money', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount: web3.toWei('50', 'finney'),
			feePercent: web3.toWei('10'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionUnresolvable();
		await this.inst.withdraw({from: acc.opponent}).should.be.eventually.fulfilled;

		const expectedBalanceDiff = {
			[acc.arbiter]:  web3.toWei('20', 'finney'),
			[acc.opponent]: 0, 
		};
		const callInfo = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = web3.toWei('50', 'finney');
		await assertBalanceDiff(callInfo, wantWithdrawalAmount, expectedBalanceDiff);
	});

	it('deleteContract should transfer all to owner if arbiter confirmed but there is no opponent and penalty amount iz zero', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount: web3.toWei('50', 'finney'),
		});
		await testCase.preconditionArbiterIsChoosenAndAgree({setPenaltyAmount: false});
		await this.inst.ArbiterPenaltyAmount().should.be.eventually.bignumber.equal(0);

		const expectedBalanceDiff = {
			[acc.arbiter]:  0,
			[acc.opponent]: 0, 
		};
		const callInfo = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = testCase.opt.betAmount;
		await assertBalanceDiff(callInfo, wantWithdrawalAmount, expectedBalanceDiff);
	});

	it('should not let deleteContract after opponent bet is made and before deadline or arbiter decision', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		
		await expectThrow(this.inst.deleteContract({from: acc.owner}));
	});

	it('deleteContract should return arbiter penlty if there is no opponent after deadline', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount: web3.toWei('50', 'finney'),
			penaltyAmount: web3.toWei('20', 'finney'),
		});
		await testCase.preconditionArbiterIsChoosenAndAgree();
		await testCase.setTimeAfterDeadline();
		await assertBalanceDiff({func: this.inst.withdraw, args: [], address: acc.owner, gasPrice}, web3.toWei('50', 'finney'));
		
		const expectedBalanceDiff = {
			[acc.arbiter]: testCase.opt.penaltyAmount,
			[acc.opponent]: 0,
		};
		const callInfo = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = 0;
		await assertBalanceDiff(callInfo, wantWithdrawalAmount, expectedBalanceDiff);
		await expectNoContract(this.inst.OwnerAddress({from: acc.anyone}));
	});

	it('deleteContract should selfdestruct if arbiter has not voted after deadline and both opponent and owner took their money', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.setTimeAfterDeadline();
		await this.inst.withdraw({from: acc.opponent}).should.be.eventually.fulfilled;
		await this.inst.withdraw({from: acc.owner}).should.be.eventually.fulfilled;
		
		const expectedBalanceDiff = {[acc.arbiter]: 0, [acc.opponent]: 0};
		const callInfo = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = 0;
		await assertBalanceDiff(callInfo, wantWithdrawalAmount, expectedBalanceDiff);
		await expectNoContract(this.inst.OwnerAddress({from: acc.anyone}));
	});

	it('deleteContract should selfdestruct if arbiter has not voted after deadline and opponent took his money', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.setTimeAfterDeadline();
		await this.inst.withdraw({from: acc.opponent}).should.be.eventually.fulfilled;
		
		const expectedBalanceDiff = {[acc.arbiter]: 0, [acc.opponent]: 0};
		const callInfo = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = await this.inst.ownerPayout();
		await assertBalanceDiff(callInfo, wantWithdrawalAmount, expectedBalanceDiff);
	});

	it('deleteContract should revert if arbiter has not voted after deadline and opponent money are not taken', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.setTimeAfterDeadline();
		
		await expectThrow(this.inst.deleteContract({from: acc.owner}));
	});

	it('deleteContract should revert if arbiter voted for false and opponent money are not taken', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionFalse();
		
		await expectThrow(this.inst.deleteContract({from: acc.owner}));
	});

	it('deleteContract should revert if arbiter voted for unresolvable and opponent money are not taken', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionUnresolvable();
		
		await expectThrow(this.inst.deleteContract({from: acc.owner}));
	});

	it('should destroy contract and return all ether to owner after call to deleteContract', async function() {
		const testCase = newBetCase(this.inst, acc, {});
		await testCase.preconditionAssertTreueAndPayoutsMade();

		const contractEtherAmount = web3.toWei('200', 'finney');
		await this.inst.sendTransaction({from: acc.owner, value: contractEtherAmount});

		const expectedBalanceDiff = {[acc.arbiter]: 0, [acc.opponent]: 0, [acc.owner]: contractEtherAmount};
		const callInfo = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		const wantWithdrawalAmount = contractEtherAmount;
		await assertBalanceDiff(callInfo, wantWithdrawalAmount, expectedBalanceDiff);
	});
});

contract('BetMe - bets in wei', function(accounts) {
	const acc = {anyone: accounts[0], owner: accounts[1], opponent: accounts[2], arbiter: accounts[3]};

	beforeEach(async function () {
		this.inst = await MockBetMe.new(...constructorArgs(), {from: acc.owner},);
	});

	const gasPrice = 10;

	it('should return double bet amount to owner and zero to arbiter when bet is 1 wei and fee percent is 99', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount: web3.toWei('1', 'wei'),
			feePercent: web3.toWei('99'),
			penaltyAmount: web3.toWei('1000', 'wei'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionTrue();

		const callInfo = {func: this.inst.withdraw, args: [], address: acc.owner, gasPrice};
		await assertBalanceDiff(callInfo, web3.toWei('2', 'wei'));

		const callInfoArbiter = {func: this.inst.withdraw, args: [], address: acc.arbiter, gasPrice};
		await assertBalanceDiff(callInfoArbiter, web3.toWei('1000', 'wei'));
	});

	it('should return bets and no arbiter fee after unresolvable bet for 1 wei', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount: web3.toWei('1', 'wei'),
			feePercent: web3.toWei('99'),
			penaltyAmount: web3.toWei('1000', 'wei'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.agreeAssertionUnresolvable();

		const callInfo = {func: this.inst.withdraw, args: [], address: acc.owner, gasPrice};
		await assertBalanceDiff(callInfo, web3.toWei('1', 'wei'));

		const callInfoOpponent = {func: this.inst.withdraw, args: [], address: acc.opponent, gasPrice};
		await assertBalanceDiff(callInfoOpponent, web3.toWei('1', 'wei'));

		const callInfoArbiter = {func: this.inst.withdraw, args: [], address: acc.arbiter, gasPrice};
		await assertBalanceDiff(callInfoArbiter, web3.toWei('1000', 'wei'));
	});

	it('should return bets and left penalty amount for deleteContract when penaltyamount is 1 wei and arbiter did not voted', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount: web3.toWei('1', 'wei'),
			penaltyAmount: web3.toWei('1', 'wei'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.setTimeAfterDeadline();

		const callInfo = {func: this.inst.withdraw, args: [], address: acc.owner, gasPrice};
		await assertBalanceDiff(callInfo, web3.toWei('1', 'wei'));

		const callInfoOpponent = {func: this.inst.withdraw, args: [], address: acc.opponent, gasPrice};
		await assertBalanceDiff(callInfoOpponent, web3.toWei('1', 'wei'));

		const callInfoArbiter = {func: this.inst.withdraw, args: [], address: acc.arbiter, gasPrice};
		await assertBalanceDiff(callInfoArbiter, web3.toWei('0', 'wei'));

		const callInfoDelete = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		await assertBalanceDiff(callInfoDelete, web3.toWei('1', 'wei'));
	});

	it('should divide penalty amount of 2 wei for opponent and owner if arbiter failed to vote', async function() {
		const testCase = newBetCase(this.inst, acc, {
			betAmount: web3.toWei('1', 'wei'),
			penaltyAmount: web3.toWei('2', 'wei'),
		});
		await testCase.preconditionOpponentBetIsMade();
		await testCase.setTimeAfterDeadline();

		const callInfo = {func: this.inst.withdraw, args: [], address: acc.owner, gasPrice};
		await assertBalanceDiff(callInfo, web3.toWei('2', 'wei'));

		const callInfoOpponent = {func: this.inst.withdraw, args: [], address: acc.opponent, gasPrice};
		await assertBalanceDiff(callInfoOpponent, web3.toWei('2', 'wei'));

		const callInfoArbiter = {func: this.inst.withdraw, args: [], address: acc.arbiter, gasPrice};
		await assertBalanceDiff(callInfoArbiter, web3.toWei('0', 'wei'));

		const callInfoDelete = {func: this.inst.deleteContract, args: [], address: acc.owner, gasPrice};
		await assertBalanceDiff(callInfoDelete, web3.toWei('0', 'wei'));
	});
});

contract('BetMe - example expected flow', function(accounts) {
	const acc = {anyone: accounts[0], owner: accounts[1], opponent: accounts[2], arbiter: accounts[3]};

	const gasPrice = 10;

	it('should successfully pass flow 1', async function() {
		const inst = await BetMe.new(
			"Gomer Simpson will win his poker game next sunday",  // Assertion text
			daysInFutureTimestamp(10),                            // Deadline
			web3.toWei('10'),                                     // arbiter fee percent
			acc.arbiter,                                          // Arbiter address
			acc.opponent,                                         // Opponent address
			web3.toWei('0'),                                      // arbiter penalty amount
			{from: acc.owner},
		);
		await inst.setArbiterPenaltyAmount(web3.toWei('200', 'finney'), {from: acc.owner}).should.be.eventually.fulfilled;
		await inst.bet({from: acc.owner, value: web3.toWei('1000', 'finney')}).should.be.eventually.fulfilled;
		const state1 = await inst.StateVersion();
		await inst.agreeToBecameArbiter(state1, {from: acc.arbiter, value: web3.toWei('200', 'finney')}).should.be.eventually.fulfilled;
		const state2 = await inst.StateVersion();
		await inst.betAssertIsFalse(state2, {from: acc.opponent, value: web3.toWei('1000', 'finney')}).should.be.eventually.fulfilled;

		await inst.agreeAssertionTrue({from: acc.arbiter}).should.be.eventually.fulfilled;

		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.arbiter, gasPrice}, web3.toWei('300', 'finney'));
		await expectThrow(inst.withdraw(), {from: acc.opponent});
		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.owner, gasPrice}, web3.toWei('1900', 'finney'));

		await assertBalanceDiff({func: inst.deleteContract, args: [], address: acc.owner, gasPrice}, web3.toWei('0', 'finney'));
		await expectNoContract(inst.OwnerAddress({from: acc.anyone}));
	});

	it('should successfully pass flow 1.5 - arbiter penalty amount set in constructor', async function() {
		const inst = await BetMe.new(
			"Gomer Simpson will win his poker game next sunday",  // Assertion text
			daysInFutureTimestamp(10),                            // Deadline
			web3.toWei('10'),                                     // arbiter fee percent
			acc.arbiter,                                          // Arbiter address
			acc.opponent,                                         // Opponent address
			web3.toWei('200', 'finney'),                          // arbiter penalty amount
			{from: acc.owner},
		);
		await inst.bet({from: acc.owner, value: web3.toWei('1000', 'finney')}).should.be.eventually.fulfilled;
		const state1 = await inst.StateVersion();
		await inst.agreeToBecameArbiter(state1, {from: acc.arbiter, value: web3.toWei('200', 'finney')}).should.be.eventually.fulfilled;
		const state2 = await inst.StateVersion();
		await inst.betAssertIsFalse(state2, {from: acc.opponent, value: web3.toWei('1000', 'finney')}).should.be.eventually.fulfilled;

		await inst.agreeAssertionTrue({from: acc.arbiter}).should.be.eventually.fulfilled;

		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.arbiter, gasPrice}, web3.toWei('300', 'finney'));
		await expectThrow(inst.withdraw(), {from: acc.opponent});
		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.owner, gasPrice}, web3.toWei('1900', 'finney'));

		await assertBalanceDiff({func: inst.deleteContract, args: [], address: acc.owner, gasPrice}, web3.toWei('0', 'finney'));
		await expectNoContract(inst.OwnerAddress({from: acc.anyone}));
	});

	it('should successfully pass flow 2', async function() {
		const inst = await MockBetMe.new(
			"Gomer Simpson will win his poker game next sunday",  // Assertion text
			daysInFutureTimestamp(10),                            // Deadline
			web3.toWei('10'),                                     // arbiter fee percent
			acc.arbiter,                                          // Arbiter address
			acc.opponent,                                         // Opponent address
			web3.toWei('0'),                                      // arbiter penalty amount
			{from: acc.owner},
		);
		await inst.setArbiterPenaltyAmount(web3.toWei('200', 'finney'), {from: acc.owner}).should.be.eventually.fulfilled;
		await inst.bet({from: acc.owner, value: web3.toWei('1000', 'finney')}).should.be.eventually.fulfilled;
		const state1 = await inst.StateVersion();
		await inst.agreeToBecameArbiter(state1, {from: acc.arbiter, value: web3.toWei('200', 'finney')}).should.be.eventually.fulfilled;
		const state2 = await inst.StateVersion();
		await inst.betAssertIsFalse(state2, {from: acc.opponent, value: web3.toWei('1000', 'finney')}).should.be.eventually.fulfilled;

		// Pretend deadline is reached before arbiter voted
		await inst.setTime(daysInFutureTimestamp(11), {from: acc.owner}).should.be.eventually.fulfilled;

		await expectThrow(inst.withdraw(), {from: acc.arbiter});
		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.opponent, gasPrice}, web3.toWei('1100', 'finney'));
		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.owner, gasPrice}, web3.toWei('1100', 'finney'));

		await assertBalanceDiff({func: inst.deleteContract, args: [], address: acc.owner, gasPrice}, web3.toWei('0', 'finney'));
		await expectNoContract(inst.OwnerAddress({from: acc.anyone}));
	});

	it('should successfully pass flow 3', async function() {
		const inst = await MockBetMe.new(
			"Gomer Simpson will win his poker game next sunday",  // Assertion text
			daysInFutureTimestamp(10),                            // Deadline
			web3.toWei('10'),                                     // arbiter fee percent
			acc.arbiter,                                          // Arbiter address
			acc.opponent,                                         // Opponent address
			web3.toWei('0'),                                      // arbiter penalty amount
			{from: acc.owner},
		);
		await inst.bet({from: acc.owner, value: web3.toWei('1000', 'finney')}).should.be.eventually.fulfilled;
		const state1 = await inst.StateVersion();
		await inst.agreeToBecameArbiter(state1, {from: acc.arbiter, value: web3.toWei('0', 'finney')}).should.be.eventually.fulfilled;
		const state2 = await inst.StateVersion();
		await inst.betAssertIsFalse(state2, {from: acc.opponent, value: web3.toWei('1000', 'finney')}).should.be.eventually.fulfilled;

		await inst.agreeAssertionFalse({from: acc.arbiter}).should.be.eventually.fulfilled;

		await expectThrow(inst.withdraw(), {from: acc.owner});
		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.opponent, gasPrice}, web3.toWei('1900', 'finney'));
		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.arbiter, gasPrice}, web3.toWei('100', 'finney'));

		await assertBalanceDiff({func: inst.deleteContract, args: [], address: acc.owner, gasPrice}, web3.toWei('0', 'finney'));
		await expectNoContract(inst.OwnerAddress({from: acc.anyone}));
	});

	it('should successfully pass flow 4: opponent is never confirmed', async function() {
		const inst = await MockBetMe.new(
			"Gomer Simpson will win his poker game next sunday",  // Assertion text
			daysInFutureTimestamp(10),                            // Deadline
			web3.toWei('10'),                                     // arbiter fee percent
			acc.arbiter,                                          // Arbiter address
			acc.opponent,                                         // Opponent address
			web3.toWei('0'),                                      // arbiter penalty amount
			{from: acc.owner},
		);
		await inst.setArbiterPenaltyAmount(web3.toWei('200', 'finney'), {from: acc.owner}).should.be.eventually.fulfilled;
		await inst.bet({from: acc.owner, value: web3.toWei('1000', 'finney')}).should.be.eventually.fulfilled;
		const state1 = await inst.StateVersion();
		await inst.agreeToBecameArbiter(state1, {from: acc.arbiter, value: web3.toWei('200', 'finney')}).should.be.eventually.fulfilled;

		await inst.setTime(daysInFutureTimestamp(11), {from: acc.owner}).should.be.eventually.fulfilled;

		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.arbiter, gasPrice}, web3.toWei('200', 'finney'));
		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.owner, gasPrice}, web3.toWei('1000', 'finney'));

		await assertBalanceDiff({func: inst.deleteContract, args: [], address: acc.owner, gasPrice}, web3.toWei('0', 'finney'));
		await expectNoContract(inst.OwnerAddress({from: acc.anyone}));
	});

	it('should successfully pass flow 5: arbiter is never found', async function() {
		const inst = await MockBetMe.new(
			"Gomer Simpson will win his poker game next sunday",  // Assertion text
			daysInFutureTimestamp(10),                            // Deadline
			web3.toWei('10'),                                     // arbiter fee percent
			acc.arbiter,                                          // Arbiter address
			acc.opponent,                                         // Opponent address
			web3.toWei('0'),                                      // arbiter penalty amount
			{from: acc.owner},
		);
		await inst.setArbiterPenaltyAmount(web3.toWei('200', 'finney'), {from: acc.owner}).should.be.eventually.fulfilled;
		await inst.bet({from: acc.owner, value: web3.toWei('1000', 'finney')}).should.be.eventually.fulfilled;

		await inst.setTime(daysInFutureTimestamp(11), {from: acc.owner}).should.be.eventually.fulfilled;

		await assertBalanceDiff({func: inst.deleteContract, args: [], address: acc.owner, gasPrice}, web3.toWei('1000', 'finney'));
		await expectNoContract(inst.OwnerAddress({from: acc.anyone}));
	});

	it('should successfully pass flow 6', async function() {
		const inst = await MockBetMe.new(
			"Gomer Simpson will win his poker game someday",      // Assertion text
			daysInFutureTimestamp(10),                            // Deadline
			web3.toWei('10'),                                     // arbiter fee percent
			acc.arbiter,                                          // Arbiter address
			acc.opponent,                                         // Opponent address
			web3.toWei('0'),                                      // arbiter penalty amount
			{from: acc.owner},
		);
		await inst.setArbiterPenaltyAmount(web3.toWei('200', 'finney'), {from: acc.owner}).should.be.eventually.fulfilled;
		await inst.bet({from: acc.owner, value: web3.toWei('1000', 'finney')}).should.be.eventually.fulfilled;
		const state1 = await inst.StateVersion();
		await inst.agreeToBecameArbiter(state1, {from: acc.arbiter, value: web3.toWei('200', 'finney')}).should.be.eventually.fulfilled;
		const state2 = await inst.StateVersion();
		await inst.betAssertIsFalse(state2, {from: acc.opponent, value: web3.toWei('1000', 'finney')}).should.be.eventually.fulfilled;

		await inst.agreeAssertionUnresolvable({from: acc.arbiter}).should.be.eventually.fulfilled;

		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.owner, gasPrice}, web3.toWei('1000', 'finney'));
		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.opponent, gasPrice}, web3.toWei('1000', 'finney'));
		await assertBalanceDiff({func: inst.withdraw, args: [], address: acc.arbiter, gasPrice}, web3.toWei('200', 'finney'));

		await assertBalanceDiff({func: inst.deleteContract, args: [], address: acc.owner, gasPrice}, web3.toWei('0', 'finney'));
		await expectNoContract(inst.OwnerAddress({from: acc.anyone}));
	});

});
