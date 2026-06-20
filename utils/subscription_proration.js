const DAY_MS = 24 * 60 * 60 * 1000;
const PAYMENT_TOLERANCE = 0.01;

const roundAmount = (n) => Math.round(Number(n) * 100) / 100;

const computeExpiresAt = (startDate, plan) => {
    const start = new Date(startDate);
    const end = new Date(start);
    const n = Number(plan.duration);
    if (plan.duration_type === 'days') {
        end.setDate(end.getDate() + n);
    } else {
        end.setMonth(end.getMonth() + n);
    }
    return end;
};

const startOfUtcDay = (instant) => {
    const x = new Date(instant);
    x.setUTCHours(0, 0, 0, 0);
    return x;
};

/**
 * Whole UTC calendar days elapsed since subscription start (minimum 0).
 */
const daysUsed = (startedAt, asOf = new Date()) => {
    const start = startOfUtcDay(startedAt);
    const now = startOfUtcDay(asOf);
    const diff = Math.floor((now.getTime() - start.getTime()) / DAY_MS);
    return Math.max(0, diff);
};

/**
 * Plan validity length in days — derived from plan.duration / duration_type only.
 */
const planValidityDays = (plan, referenceStart = new Date()) => {
    const start = new Date(referenceStart);
    const end = computeExpiresAt(start, plan);
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    return Math.max(1, days);
};

/** Canonical tier ladder — matches subscription_plan PLAN_NAMES order. */
const PLAN_TIER_RANK = {
    basic: 1,
    silver: 2,
    gold: 3,
    platinum: 4,
};

const planTierRank = (plan) => {
    const name = plan?.plan_name != null ? String(plan.plan_name).trim().toLowerCase() : '';
    return PLAN_TIER_RANK[name] ?? null;
};

const resolveChangeType = (currentPlan, newPlan) => {
    if (String(currentPlan._id) === String(newPlan._id)) {
        return 'same';
    }

    const tierCur = planTierRank(currentPlan);
    const tierNew = planTierRank(newPlan);
    if (tierCur != null && tierNew != null && tierCur !== tierNew) {
        return tierNew > tierCur ? 'upgrade' : 'downgrade';
    }

    const pCur = currentPlan.priority;
    const pNew = newPlan.priority;
    if (pCur != null && pNew != null && pCur !== pNew) {
        // DB convention: lower priority number = higher tier (platinum=1 … basic=4).
        return pNew < pCur ? 'upgrade' : 'downgrade';
    }

    const priceCur = Number(currentPlan.price) || 0;
    const priceNew = Number(newPlan.price) || 0;
    if (priceNew > priceCur) return 'upgrade';
    if (priceNew < priceCur) return 'downgrade';
    return 'lateral';
};

const computeProration = ({ currentPlan, newPlan, startedAt, asOf = new Date() }) => {
    const D = planValidityDays(currentPlan, startedAt);
    const U = Math.min(daysUsed(startedAt, asOf), D);
    const P_cur = roundAmount(currentPlan.price);
    const P_new = roundAmount(newPlan.price);
    const dailyRate = roundAmount(P_cur / D);
    const consumedValue = roundAmount(U * dailyRate);
    const remainingValue = roundAmount(Math.max(0, P_cur - consumedValue));
    const changeType = resolveChangeType(currentPlan, newPlan);

    let amountToPay = 0;
    let walletCredit = 0;

    if (changeType === 'upgrade') {
        amountToPay = roundAmount(Math.max(0, P_new - remainingValue));
    } else if (changeType === 'downgrade') {
        amountToPay = roundAmount(Math.max(0, P_new - remainingValue));
        walletCredit = roundAmount(Math.max(0, remainingValue - P_new));
    }

    const newPeriodDays = planValidityDays(newPlan, asOf);

    return {
        change_type: changeType,
        days_total: D,
        days_used: U,
        days_remaining: Math.max(0, D - U),
        daily_rate: dailyRate,
        consumed_value: consumedValue,
        remaining_value: remainingValue,
        gross_new_plan_price: P_new,
        current_plan_price: P_cur,
        amount_to_pay: amountToPay,
        wallet_credit: walletCredit,
        new_period_days: newPeriodDays,
        new_expires_at: computeExpiresAt(asOf, newPlan),
    };
};

const resolvePaymentMethod = ({ amountToPay, walletAmount, cashAmount, onlineAmount = 0 }) => {
    if (amountToPay <= PAYMENT_TOLERANCE) {
        return 'not_required';
    }
    const wallet = roundAmount(walletAmount);
    const cash = roundAmount(cashAmount);
    const online = roundAmount(onlineAmount);
    if (wallet > 0 && online > 0) return 'wallet_and_online';
    if (online > 0) return 'online';
    if (wallet > 0 && cash > 0) return 'wallet_and_cash';
    if (wallet > 0) return 'wallet';
    if (cash > 0) return 'cash';
    return 'not_required';
};

const validateUpgradePaymentSplit = ({
    amountToPay,
    walletAmount,
    cashAmount,
    onlineAmount = 0,
    walletBalance,
}) => {
    const due = roundAmount(amountToPay);
    const wallet = roundAmount(walletAmount);
    const cash = roundAmount(cashAmount);
    const online = roundAmount(onlineAmount);
    const balance = roundAmount(walletBalance);

    if (due <= PAYMENT_TOLERANCE) {
        if (wallet > PAYMENT_TOLERANCE || cash > PAYMENT_TOLERANCE || online > PAYMENT_TOLERANCE) {
            return { ok: false, message: 'No payment is required for this subscription change.' };
        }
        return { ok: true, wallet: 0, cash: 0, online: 0, payment_method: 'not_required' };
    }

    if (wallet < 0 || cash < 0 || online < 0) {
        return { ok: false, message: 'Payment amounts cannot be negative.' };
    }

    if (cash > PAYMENT_TOLERANCE && online > PAYMENT_TOLERANCE) {
        return {
            ok: false,
            message: 'Use either cash_amount or online_amount for the non-wallet portion, not both.',
        };
    }

    if (wallet > balance + PAYMENT_TOLERANCE) {
        return {
            ok: false,
            message: `Wallet amount exceeds available balance (${balance}).`,
        };
    }

    if (Math.abs(wallet + cash + online - due) > PAYMENT_TOLERANCE) {
        return {
            ok: false,
            message: 'Wallet, cash, and online amounts must add up to the amount due.',
        };
    }

    return {
        ok: true,
        wallet,
        cash,
        online,
        payment_method: resolvePaymentMethod({
            amountToPay: due,
            walletAmount: wallet,
            cashAmount: cash,
            onlineAmount: online,
        }),
    };
};

module.exports = {
    PAYMENT_TOLERANCE,
    roundAmount,
    computeExpiresAt,
    daysUsed,
    planValidityDays,
    resolveChangeType,
    computeProration,
    resolvePaymentMethod,
    validateUpgradePaymentSplit,
};
