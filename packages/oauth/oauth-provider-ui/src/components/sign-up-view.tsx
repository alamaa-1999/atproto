import { msg } from '@lingui/core/macro'
import { Trans } from '@lingui/react/macro'
import { useState } from 'react'
import { useCustomizationData } from '#/contexts/customization.tsx'
import { SignUpWizard } from './forms/sign-up-wizard.tsx'
import { AuthShell } from './layouts/auth-shell.tsx'
import {
  type SignUpCredentialsData,
  SignUpCredentialsForm,
} from './sign-up-credentials-form.tsx'
import { SignUpDisclaimer } from './sign-up-disclaimer.tsx'
import {
  type SignUpHandleData,
  SignUpHandleForm,
} from './sign-up-handle-form.tsx'
import {
  type SignUpHcaptchaData,
  SignUpHcaptchaForm,
} from './sign-up-hcaptcha-form.tsx'

export type SignUpViewProps = {
  onBack?: () => void
  onValidateNewHandle: (data: SignUpHandleData) => void | PromiseLike<void>
  onDone: (
    data: SignUpCredentialsData & {
      handle: string
      hcaptchaToken?: string
    },
  ) => void | PromiseLike<void>
}

export function SignUpView({
  onBack,
  onValidateNewHandle,
  onDone,
}: SignUpViewProps) {
  const {
    availableUserDomains = [],
    hcaptchaSiteKey = undefined,
    inviteCodeRequired = true,
    links,
  } = useCustomizationData()

  // Sign-up (this flow) always creates a Catcher account server-side — see
  // the PDS's role enforcement — so only the "guest" domain should ever be
  // offered as a choice here. Offering the primary domain too would let
  // someone pick a handle the server immediately rejects, since Striker is
  // never a self-signup outcome. Falls back to the full list if none match,
  // so a deployment that doesn't follow this naming convention still works.
  const guestDomains = availableUserDomains.filter((d) =>
    d.startsWith('.guest'),
  )
  const signUpDomains =
    guestDomains.length > 0 ? guestDomains : availableUserDomains

  // Keep a copy of all every step's form values in case the user changes a step
  // and goes back to the previous step, allowing to keep the un-submitted
  // values in the form inputs.
  const [pending, setPending] = useState<
    Partial<SignUpCredentialsData & SignUpHandleData & SignUpHcaptchaData>
  >({})

  // @NOTE Only the last step creates the account, so only the last step states
  // what creating one agrees to. Which step that is depends on whether hCaptcha
  // is configured, so the wizard decides it (`atLast`) rather than this list.
  const disclaimer = <SignUpDisclaimer links={links} />

  return (
    <AuthShell
      title={msg({ message: 'Sign up' })}
      subtitle={<Trans>We're so excited to have you join us!</Trans>}
    >
      <SignUpWizard
        onBack={onBack}
        doneLabel={<Trans>Sign up</Trans>}
        onDone={([handle, credentials, hcaptcha]: [
          SignUpHandleData,
          SignUpCredentialsData,
          SignUpHcaptchaData | null,
        ]) => {
          return onDone({
            ...credentials,
            ...handle,
            hcaptchaToken: hcaptcha?.verify.token,
          })
        }}
        steps={[
          // We use the handle input first since the "onValidateNewHandle" check
          // will make it less likely that the actual signup call will fail, and
          // will result in a better user experience, especially if there is an
          // issue with the email address (e.g. already in use).
          {
            titleRender: () => <Trans>Choose a username</Trans>,
            contentRender: ({ atLast, prev, prevLabel, next, nextLabel }) => (
              <SignUpHandleForm
                className="grow"
                domains={signUpDomains}
                onBack={prev}
                backLabel={prevLabel}
                submitLabel={nextLabel}
                values={pending}
                onValues={(val) => setPending((old) => ({ ...old, ...val }))}
                handler={async (data) => {
                  await onValidateNewHandle(data)
                  next(data)
                }}
              >
                {atLast && disclaimer}
              </SignUpHandleForm>
            ),
          },
          {
            titleRender: () => <Trans>Your account</Trans>,
            contentRender: ({ atLast, prev, prevLabel, next, nextLabel }) => (
              <SignUpCredentialsForm
                className="grow"
                onBack={prev}
                backLabel={prevLabel}
                submitLabel={nextLabel}
                values={pending}
                onValues={(val) => setPending((old) => ({ ...old, ...val }))}
                handler={next}
                inviteCodeRequired={inviteCodeRequired}
              >
                {atLast && disclaimer}
              </SignUpCredentialsForm>
            ),
          },
          hcaptchaSiteKey != null && {
            titleRender: () => <Trans>Verify you are human</Trans>,
            contentRender: ({ atLast, prev, prevLabel, next, nextLabel }) => (
              <SignUpHcaptchaForm
                className="grow"
                siteKey={hcaptchaSiteKey}
                onBack={prev}
                backLabel={prevLabel}
                submitLabel={nextLabel}
                values={pending}
                onValues={(val) => setPending((old) => ({ ...old, ...val }))}
                handler={next}
              >
                {atLast && disclaimer}
              </SignUpHcaptchaForm>
            ),
          },
        ]}
      />
    </AuthShell>
  )
}
