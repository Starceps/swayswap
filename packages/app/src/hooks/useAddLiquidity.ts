import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation } from 'react-query';
import type { UseQueryResult } from 'react-query';

import { useBalances } from './useBalances';

import type { UseCoinInput } from '~/components/CoinInput';
import { SLIPPAGE_TOLERANCE } from '~/config';
import { useContract } from '~/context/AppContext';
import type { Coin } from '~/types';
import type { PoolInfo } from '~/types/contracts/Exchange_contractAbi';

export interface UseAddLiquidityProps {
  fromInput: UseCoinInput;
  toInput: UseCoinInput;
  poolInfoQuery: UseQueryResult<PoolInfo | undefined, unknown>;
  coinFrom: Coin;
  coinTo: Coin;
  reservesFromToRatio: number;
  addLiquidityRatio: number;
}

export function useAddLiquidity({
  fromInput,
  toInput,
  poolInfoQuery,
  coinFrom,
  coinTo,
  reservesFromToRatio,
  addLiquidityRatio,
}: UseAddLiquidityProps) {
  const [errorsCreatePull, setErrorsCreatePull] = useState<string[]>([]);
  const contract = useContract()!;
  const [stage, setStage] = useState(0);
  const balances = useBalances();

  const mutation = useMutation(
    async () => {
      const fromAmount = fromInput.amount;
      const toAmount = toInput.amount;
      if (!fromAmount || !toAmount) return;

      // TODO: Combine all transactions on single tx leverage by scripts
      // https://github.com/FuelLabs/swayswap-demo/issues/42

      // Deposit coins from
      await contract.functions.deposit({
        forward: [fromAmount, coinFrom.assetId],
      });
      setStage((s) => s + 1);
      // Deposit coins to
      await contract.functions.deposit({
        forward: [toAmount, coinTo.assetId],
      });
      setStage((s) => s + 1);
      // Create liquidity pool
      await contract.functions.add_liquidity(1, toAmount, 1000, {
        variableOutputs: 1,
      });
      setStage((s) => s + 1);
    },
    {
      onSuccess: () => {
        toast.success(reservesFromToRatio ? 'Added liquidity to the pool.' : 'New pool created.');
        fromInput.setAmount(BigInt(0));
        toInput.setAmount(BigInt(0));
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onError: (e: any) => {
        const errors = e?.response?.errors;

        if (errors?.length) {
          if (errors[0].message === 'enough coins could not be found') {
            toast.error(
              `Not enough balance in your wallet to ${
                reservesFromToRatio ? 'add liquidity to' : 'create'
              } this pool.`
            );
          }
        } else {
          toast.error(
            `Error when trying to ${reservesFromToRatio ? 'add liquidity to' : 'create'} this pool.`
          );
        }
      },
      onSettled: async () => {
        await poolInfoQuery.refetch();
        await balances.refetch();

        setStage(0);
      },
    }
  );

  const validateCreatePool = () => {
    const errors = [];

    if (!fromInput.amount) {
      errors.push(`Enter ${coinFrom.name} amount`);
    }
    if (!toInput.amount) {
      errors.push(`Enter ${coinTo.name} amount`);
    }
    if (!fromInput.hasEnoughBalance) {
      errors.push(`Insufficient ${coinFrom.name} balance`);
    }
    if (!toInput.hasEnoughBalance) {
      errors.push(`Insufficient ${coinTo.name} balance`);
    }

    if (reservesFromToRatio) {
      const minRatio = reservesFromToRatio * (1 - SLIPPAGE_TOLERANCE);

      if (addLiquidityRatio < minRatio || addLiquidityRatio > reservesFromToRatio) {
        errors.push(`Entered ratio doesn't match pool`);
      }
    }

    return errors;
  };

  useEffect(() => {
    setErrorsCreatePull(validateCreatePool());
  }, [
    fromInput.amount,
    toInput.amount,
    fromInput.hasEnoughBalance,
    toInput.hasEnoughBalance,
    reservesFromToRatio,
    addLiquidityRatio,
  ]);

  return {
    stage,
    mutation,
    errorsCreatePull,
  };
}