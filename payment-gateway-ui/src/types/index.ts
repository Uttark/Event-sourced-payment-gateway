export interface User {
  id: string;
  name: string;
  email: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
}

export const SUPPORTED_CURRENCIES = ['USD', 'INR', 'EUR', 'GBP'] as const;
export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

export interface Wallet {
  id: string;
  currency: string;
  balance: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WalletsApiResponse {
  success: boolean;
  data: {
    wallets: Wallet[];
    count: number;
  };
}

export interface CreateWalletApiResponse {
  success: boolean;
  message: string;
  data: {
    wallet: Wallet;
  };
}

export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'FLAGGED';
export type TransactionType = 'TOPUP' | 'PAYOUT' | 'TRANSFER' | 'TRANSFER_IN' | 'TRANSFER_OUT';

export interface Transaction {
  id: string;
  amount: number;
  type: TransactionType;
  status: TransactionStatus;
  currency: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface TopupInitiateResponse {
  success: boolean;
  data: {
    orderId: string;
    transactionId: string;
    amount: string;
    currency: string;
  };
}

export interface CreateTransactionApiResponse {
  success: boolean;
  message: string;
  data: {
    transactionId: string;
    status: 'COMPLETED' | 'FAILED' | 'PROCESSING';
    eventType: string;
    amount: string;
    currency: string;
    walletBalance: string | null;
    gatewayOrderId: string | null;
    fraudFlagged: boolean;
    createdAt: string;
  };
}

export interface TransferApiResponse {
  success: boolean;
  message: string;
  data: {
    transactionId:     string;
    senderWalletId:    string;
    recipientWalletId: string;
    amount:            string;
    currency:          string;
    eventType:         string;
    createdAt:         string;
  };
}

export interface ApiError {
  statusCode:  number;
  message:     string;

  retryAfter?: number;
}

export type TransactionFilterType =
  | 'all'
  | 'topups'
  | 'transfers'
  | 'payments'
  | 'failed';

export type TopupStatus =
  | 'idle'
  | 'initiating'
  | 'awaiting_payment'
  | 'verifying'
  | 'polling'
  | 'success'
  | 'error';

export type SendMoneyStatus = 'idle' | 'submitting' | 'success' | 'error';

export interface SendMoneyErrorInfo {
  statusCode: number;
  message: string;
  kind: 'GATEWAY_DECLINE' | 'FRAUD_BLOCK' | 'WALLET_BUSY' | 'GENERIC';
}

export function classifySendMoneyError(err: ApiError): SendMoneyErrorInfo {
  switch (err.statusCode) {
    case 402:
      return { ...err, kind: 'GATEWAY_DECLINE' };
    case 403:
      return { ...err, kind: 'FRAUD_BLOCK' };
    case 409:
      return { ...err, kind: 'WALLET_BUSY' };
    default:
      return { ...err, kind: 'GENERIC' };
  }
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  INR: '₹',
  EUR: '€',
  GBP: '£',
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency;
}

export function formatAmount(amount: number | string): string {
  const parsed = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed);
}

export const formatINR = formatAmount;

export interface TransactionDetailEvent {
  eventId:          string;
  eventType:        string;
  amount:           string;
  currency:         string;
  gatewayOrderId:   string | null;
  gatewayPaymentId: string | null;
  fraudScore:       number | null;
  metadata:         Record<string, unknown>;
  createdAt:        string;
}

export interface TransactionDetail {
  transactionId: string;
  currentStatus: string;
  walletId:      string;
  currency:      string;
  amount:        string;
  eventCount:    number;
  events:        TransactionDetailEvent[];
}

export interface TransactionDetailApiResponse {
  success: boolean;
  data:    TransactionDetail;
}

export interface HealthStatus {
  status:    'ok' | 'degraded';
  timestamp: string;
  version:   string;
  services: {
    database: 'connected' | 'error' | 'unknown';
    redis:    'connected' | 'error' | 'unknown';
  };
}

export interface DLQItem {
  id:                 string;
  webhookDeliveryId:  string;
  webhookEndpointId:  string;
  transactionEventId: string;
  failureReason:      string;
  attemptCount:       number;
  createdAt:          string;
  resolvedAt:         string | null;
  resolvedBy:         string | null;
}

export interface DLQListApiResponse {
  success: boolean;
  data: {
    items:      DLQItem[];
    pagination: { total: number; page: number; limit: number; totalPages: number };
  };
}

export interface DLQStats {
  total:               number;
  unresolved:          number;
  resolved:            number;
  topFailingEndpoints: Array<{ endpointId: string; unresolvedCount: number }>;
}

export interface DLQStatsApiResponse {
  success: boolean;
  data:    { stats: DLQStats };
}

export interface RateLimitInfo {
  merchantId: string;
  isCustom:   boolean;
  effective:  { maxRequests: number; windowMs: number };
  status:     string;
}

export interface RateLimitApiResponse {
  success: boolean;
  data:    RateLimitInfo;
}

export interface OrphanedTransaction {
  transactionId:  string;
  sourceEventId:  string;
  walletId:       string;
  amount:         string;
  currency:       string;
  gatewayOrderId: string | null;
}

export interface OrphansApiResponse {
  success: boolean;
  data: {
    count:     number;
    isHealthy: boolean;
    orphans:   OrphanedTransaction[];
  };
}

export interface BalanceMismatch {
  walletId:             string;
  authoritativeBalance: string;
  eventDerivedBalance:  string;
  difference:           string;
}

export interface IntegrityCheckApiResponse {
  success: boolean;
  data: {
    isConsistent:  boolean;
    mismatchCount: number;
    mismatches:    BalanceMismatch[];
    message:       string;
  };
}

export interface Merchant {
  id:           string;
  businessName: string;
  createdAt:    string;
}

export interface MerchantCreateApiResponse {
  success: boolean;
  message: string;
  data: {
    merchant: Merchant & { webhookSecret: string };
  };
}

export interface MerchantGetApiResponse {
  success: boolean;
  data: {
    merchant: Merchant;
  };
}

export interface WebhookEndpoint {
  id:         string;
  merchantId: string;
  url:        string;
  isActive:   boolean;
  eventTypes: string[];
  createdAt:  string;
}

export interface WebhookEndpointsApiResponse {
  success: boolean;
  data: {
    endpoints: WebhookEndpoint[];
    count:     number;
  };
}

export interface CreateEndpointApiResponse {
  success: boolean;
  message: string;
  data: {
    endpoint: WebhookEndpoint;
  };
}