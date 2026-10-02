export type PriceHandler = (price: number) => Promise<void>;

export class FakePriceFeed {
  constructor(private readonly prices: number[]) {}

  async start(onPrice: PriceHandler): Promise<void> {
    for (const price of this.prices) await onPrice(price);
  }
}
