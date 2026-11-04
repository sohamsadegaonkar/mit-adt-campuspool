import 'package:flutter_test/flutter_test.dart';
import 'package:campuspool_flutter/pricing.dart';

void main() {
  test('base demonstration quote is ₹55', () {
    const quote = CampusQuote();
    expect(quote.estimatedTotal, 55);
    expect(quote.runnerReward, 10);
  });

  test('tips add to total and runner reward, not to item price', () {
    const base = CampusQuote();
    expect(base.withTip(10).estimatedTotal, 65);
    expect(base.withTip(20).estimatedTotal, 75);
    expect(base.withTip(30).estimatedTotal, 85);
    expect(base.withTip(20).runnerReward, 30);
    expect(base.withTip(20).itemPrice, 40);
    expect(base.withTip(20).serviceFee, 5);
  });

  test('rupee formatting keeps the unit explicit', () {
    expect(CampusQuote.rupees(75), '₹75');
  });
}
