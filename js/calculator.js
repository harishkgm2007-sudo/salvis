/**
 * Smart Dynamic Calculator & Financial Engine
 */

const FREQUENCY_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30.44 };

const FREQUENCY_LABELS = {
  daily: 'day',
  weekly: 'week',
  biweekly: 'bi-week',
  monthly: 'month'
};

class SavingsCalculator {
  static calculateSchedule(targetAmount, savedAmount, startDateStr, targetDateStr, frequency = 'weekly', options = {}) {
    const target = Math.max(0, parseFloat(targetAmount) || 0);
    const saved = Math.max(0, parseFloat(savedAmount) || 0);
    const remainingToSave = Math.max(0, target - saved);
    const surplus = Math.max(0, saved - target);

    const now = new Date();
    const targetDate = new Date(targetDateStr);
    const diffTime = targetDate.getTime() - now.getTime();
    const remainingDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

    const intervalDays = FREQUENCY_DAYS[frequency] || 7;
    const remainingIntervals = Math.max(1, Math.ceil(remainingDays / intervalDays));

    const paymentPerInterval = remainingToSave > 0 ? remainingToSave / remainingIntervals : 0;
    const progressPercentage = target > 0 ? Math.min(100, (saved / target) * 100) : 0;

    const projectedCompletionDate = this._projectedCompletionDate(
      saved, target, paymentPerInterval, intervalDays
    );
    const isCompleted = saved >= target;
    const isOverpaid = saved > target;

    return {
      targetAmount: target,
      savedAmount: saved,
      surplus,
      isOverpaid,
      remainingToSave,
      remainingDays,
      remainingIntervals,
      paymentPerInterval: parseFloat(paymentPerInterval.toFixed(2)),
      frequency,
      progressPercentage: parseFloat(progressPercentage.toFixed(1)),
      isCompleted,
      frequencyLabel: FREQUENCY_LABELS[frequency] || frequency,
      formattedPayment: `${this.formatCurrency(paymentPerInterval)} / ${FREQUENCY_LABELS[frequency] || frequency}`,
      projectedCompletionDate,
      projectedCompletionLabel: projectedCompletionDate
        ? projectedCompletionDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : '—'
    };
  }

  static _projectedCompletionDate(saved, target, paymentPerInterval, intervalDays) {
    if (paymentPerInterval <= 0) return null;
    const remaining = Math.max(0, target - saved);
    const intervalsToGo = Math.ceil(remaining / paymentPerInterval);
    const date = new Date();
    date.setDate(date.getDate() + Math.round(intervalsToGo * intervalDays));
    return date;
  }

  static simulatePriceShift(currentGoal, newTargetPrice) {
    const newTarget = parseFloat(newTargetPrice);
    return this.calculateSchedule(
      newTarget,
      currentGoal.savedAmount,
      currentGoal.startDate,
      currentGoal.targetDate,
      currentGoal.frequency
    );
  }

  static getActiveUserCurrency() {
    try {
      const auth = typeof AuthService !== 'undefined' ? AuthService : (window.AuthService || null);
      const user = auth ? auth.getCurrentUser() : null;
      if (user && user.currencyCode) {
        return {
          code: user.currencyCode,
          locale: user.locale || 'en-US',
          symbol: user.currencySymbol || '$',
          country: user.country || 'United States'
        };
      }
    } catch (e) {}
    try {
      const auth = typeof AuthService !== 'undefined' ? AuthService : (window.AuthService || null);
      if (auth && auth.detectRegionAndCurrency) {
        const region = auth.detectRegionAndCurrency();
        return {
          code: region.currencyCode,
          locale: region.locale,
          symbol: region.currencySymbol,
          country: region.country
        };
      }
    } catch (e) {}
    return { code: 'USD', locale: 'en-US', symbol: '$', country: 'United States' };
  }

  static formatCurrency(amount) {
    const curr = this.getActiveUserCurrency();
    const value = parseFloat(amount) || 0;
    try {
      return new Intl.NumberFormat(curr.locale, {
        style: 'currency',
        currency: curr.code,
        maximumFractionDigits: 2
      }).format(value);
    } catch (e) {
      return `${curr.symbol}${value.toFixed(2)}`;
    }
  }
}

if (typeof window !== 'undefined') {
  window.SavingsCalculator = SavingsCalculator;
}