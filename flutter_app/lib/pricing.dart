/// Illustrative quote only. No money is collected by the Flutter prototype.
class CampusQuote {
  const CampusQuote({
    this.itemPrice = 40,
    this.baseReward = 10,
    this.serviceFee = 5,
    this.extraTip = 0,
  }) : assert(itemPrice >= 0),
       assert(baseReward >= 0),
       assert(serviceFee >= 0),
       assert(extraTip >= 0);

  final int itemPrice;
  final int baseReward;
  final int serviceFee;
  final int extraTip;

  int get estimatedTotal => itemPrice + baseReward + serviceFee + extraTip;
  int get runnerReward => baseReward + extraTip;

  CampusQuote withTip(int value) => CampusQuote(
    itemPrice: itemPrice,
    baseReward: baseReward,
    serviceFee: serviceFee,
    extraTip: value,
  );

  static String rupees(int value) => '₹$value';
}
