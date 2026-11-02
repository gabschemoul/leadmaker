'use client';

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { TriangleAlert } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@kit/ui/form';
import { If } from '@kit/ui/if';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@kit/ui/input-otp';
import { Spinner } from '@kit/ui/spinner';
import { Trans } from '@kit/ui/trans';

import { sendOtpEmailAction } from '../server/server-actions';

// Email form schema
const SendOtpSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address' }),
});

// OTP verification schema
const VerifyOtpSchema = z.object({
  otp: z.string().min(6, { message: 'Please enter a valid OTP code' }).max(6),
});

type VerifyOtpFormProps = {
  // Purpose of the OTP (e.g., 'email-verification', 'password-reset')
  purpose: string;
  // Callback when OTP is successfully verified
  onSuccess: (otp: string) => void;
  // Email address to send the OTP to
  email: string;
  // Customize form appearance
  className?: string;
  // Optional cancel button
  CancelButton?: React.ReactNode;
};

export function VerifyOtpForm({
  purpose,
  email,
  className,
  CancelButton,
  onSuccess,
}: VerifyOtpFormProps) {
  // Track the current step (email entry or OTP verification)
  const [step, setStep] = useState<'email' | 'otp'>('email');

  // Track errors
  const [error, setError] = useState<string | null>(null);

  const locale = useLocale();

  const { execute: executeSendOtp, isPending } = useAction(sendOtpEmailAction, {
    onSuccess: ({ data }) => {
      if (data?.success) {
        setStep('otp');
        setError(null);
      } else {
        setError(data?.error || 'Failed to send OTP. Please try again.');
      }
    },
    onError: () => {
      setError('An unexpected error occurred. Please try again.');
    },
  });

  // Email form
  const emailForm = useForm({
    resolver: zodResolver(SendOtpSchema),
    values: {
      email,
    },
  });

  // OTP verification form
  const otpForm = useForm({
    resolver: zodResolver(VerifyOtpSchema),
    defaultValues: {
      otp: '',
    },
  });

  // Handle sending OTP email
  const handleSendOtp = () => {
    setError(null);

    executeSendOtp({
      purpose,
      email,
      language: locale,
    });
  };

  // Handle OTP verification
  const handleVerifyOtp = (data: z.output<typeof VerifyOtpSchema>) => {
    onSuccess(data.otp);
  };

  return (
    <div className={className}>
      {step === 'email' ? (
        <Form {...emailForm}>
          <form
            className="flex flex-col gap-y-8"
            onSubmit={emailForm.handleSubmit(handleSendOtp)}
          >
            <div className="flex flex-col gap-y-2">
              <p className="text-muted-foreground text-sm">
                <Trans
                  i18nKey="common.otp.requestVerificationCodeDescription"
                  values={{ email }}
                />
              </p>
            </div>

            <If condition={Boolean(error)}>
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />

                <AlertTitle>
                  <Trans i18nKey="common.otp.errorSendingCode" />
                </AlertTitle>

                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </If>

            <div className="flex w-full justify-end gap-2">
              {CancelButton}

              <Button
                type="submit"
                disabled={isPending}
                data-test="otp-send-verification-button"
              >
                {isPending ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    <Trans i18nKey="common.otp.sendingCode" />
                  </>
                ) : (
                  <Trans i18nKey="common.otp.sendVerificationCode" />
                )}
              </Button>
            </div>
          </form>
        </Form>
      ) : (
        <Form {...otpForm}>
          <div className="flex w-full flex-col items-center gap-y-8">
            <div className="text-muted-foreground text-sm">
              <Trans i18nKey="common.otp.codeSentToEmail" values={{ email }} />
            </div>

            <form
              className="flex w-full flex-col items-center space-y-8"
              onSubmit={otpForm.handleSubmit(handleVerifyOtp)}
            >
              <If condition={Boolean(error)}>
                <Alert variant="destructive">
                  <TriangleAlert className="h-4 w-4" />

                  <AlertTitle>
                    <Trans i18nKey="common.error" />
                  </AlertTitle>

                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </If>

              <FormField
                name="otp"
                control={otpForm.control}
                render={({ field }) => (
                  <FormItem className="w-full">
                    <FormControl className="mx-auto">
                      <InputOTP
                        maxLength={6}
                        {...field}
                        disabled={isPending}
                        data-test="otp-input"
                      >
                        <InputOTPGroup>
                          <InputOTPSlot index={0} data-slot="0" />
                          <InputOTPSlot index={1} data-slot="1" />
                          <InputOTPSlot index={2} data-slot="2" />
                        </InputOTPGroup>
                        <InputOTPSeparator />
                        <InputOTPGroup>
                          <InputOTPSlot index={3} data-slot="3" />
                          <InputOTPSlot index={4} data-slot="4" />
                          <InputOTPSlot index={5} data-slot="5" />
                        </InputOTPGroup>
                      </InputOTP>
                    </FormControl>

                    <FormDescription className="text-center">
                      <Trans i18nKey="common.otp.enterCodeFromEmail" />
                    </FormDescription>

                    <FormMessage className="text-center" />
                  </FormItem>
                )}
              />

              <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                {CancelButton}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => setStep('email')}
                  >
                    <Trans i18nKey="common.otp.requestNewCode" />
                  </Button>

                  <Button
                    type="submit"
                    disabled={isPending}
                    data-test="otp-verify-button"
                  >
                    {isPending ? (
                      <>
                        <Spinner className="mr-2 h-4 w-4" />
                        <Trans i18nKey="common.otp.verifying" />
                      </>
                    ) : (
                      <Trans i18nKey="common.otp.verifyCode" />
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </Form>
      )}
    </div>
  );
}
