#!/usr/bin/env python3
"""Génère les modèles d'e-mails Supabase Auth (apps/web/supabase/templates/*.html) : confirmation d'adresse,
mot de passe oublié, changement d'adresse, lien magique, invitation Supabase.

    python3 apps/web/scripts/generate-auth-emails.py

Chaque modèle contient le français ET l'anglais : Supabase choisit selon les données de l'utilisateur
(user_metadata.lang, posée à l'inscription par l'application) ; sans indication, français. Les couleurs sont
celles de l'application (thème Atlas, apps/web/styles/theme.css). Les sujets, bilingues eux aussi, sont dans
apps/web/supabase/config.toml. Après modification : `supabase stop && supabase start` en local, et en ligne
apps/web/scripts/push-auth-emails.sh (base partagée prod + pré-prod).
"""
import pathlib

OUT = pathlib.Path(__file__).resolve().parents[1] / 'supabase' / 'templates'

LANG_PICK = ('{{ $en := false }}{{ with .Data }}{{ with .lang }}{{ if eq . "en" }}{{ $en = true }}'
             '{{ end }}{{ end }}{{ end }}')


def block(fr: str, en: str) -> str:
    return '{{ if $en }}' + en + '{{ else }}' + fr + '{{ end }}'


def page(title_fr, title_en, heading_fr, heading_en, body_fr, body_en, button_fr, button_en, href,
         code_fr=None, code_en=None, after_fr=None, after_en=None):
    code = ''
    if code_fr:
        code = f'''
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 4px 0;background-color:#eef3f1;border-radius:8px">
                <tr><td style="padding:16px 8px;text-align:center">
                  <p style="margin:0 0 6px 0;font-size:13px;line-height:18px;color:#5f6f6c">{block(code_fr, code_en)}</p>
                  <p style="margin:0;font-size:30px;line-height:36px;font-weight:600;letter-spacing:4px;color:#0e2a27">{{{{ .Token }}}}</p>
                </td></tr>
              </table>'''
    after = ''
    if after_fr:
        after = f'''
              <p style="margin:16px 0 0 0;font-size:13px;line-height:20px;color:#5f6f6c">{block(after_fr, after_en)}</p>'''
    return f'''{LANG_PICK}<!DOCTYPE html>
<html lang="{block('fr', 'en')}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="only light">
  <meta name="supported-color-schemes" content="light">
  <title>{block(title_fr, title_en)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f6f5;font-family:'Figtree','Segoe UI',Helvetica,Arial,sans-serif;color:#1a2321">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">{block(title_fr, title_en)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f6f5">
    <tr><td align="center" style="padding:32px 20px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="padding:0 0 20px 0;font-size:22px;line-height:28px;font-weight:800;letter-spacing:-0.5px;color:#0e2a27">
          Prospectigo<span style="display:inline-block;width:7px;height:7px;margin-left:3px;border-radius:7px;background-color:#f2b531"></span>
        </td></tr>
        <tr><td style="padding:0 0 16px 0;font-size:22px;line-height:28px;font-weight:700;color:#0e2a27">{block(heading_fr, heading_en)}</td></tr>
        <tr><td style="background-color:#ffffff;border:1px solid #dfe7e4;border-radius:12px;padding:28px 32px">
              <p style="margin:0 0 14px 0;font-size:16px;line-height:24px;color:#1a2321">{block(body_fr, body_en)}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0">
                <tr><td>
                  <a href="{href}" target="_blank" style="display:block;box-sizing:border-box;width:100%;padding:13px 20px;border-radius:8px;background-color:#0f5a52;color:#ffffff;font-size:16px;font-weight:600;text-align:center;text-decoration:none">{block(button_fr, button_en)}</a>
                </td></tr>
              </table>{code}{after}
        </td></tr>
        <tr><td style="padding:16px 8px 0 8px;font-size:12px;line-height:20px;color:#8a9794">Prospectigo · <a href="https://prospectigo.com" style="color:#8a9794">prospectigo.com</a></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
'''


IGNORE_FR = 'Si vous n’êtes pas à l’origine de cette demande, ignorez simplement cet e-mail.'
IGNORE_EN = 'If you did not request this, you can safely ignore this email.'
CODE_FR, CODE_EN = 'Ou saisissez ce code dans l’application :', 'Or enter this code in the app:'

FILES = {
    'confirm-email.html': page(
        'Confirmez votre adresse e-mail', 'Confirm your email address',
        'Bienvenue sur Prospectigo', 'Welcome to Prospectigo',
        'Plus qu’une étape : cliquez sur le bouton ci-dessous pour confirmer votre adresse e-mail et activer votre compte.',
        'One last step: click the button below to confirm your email address and activate your account.',
        'Confirmer mon adresse e-mail', 'Confirm my email address',
        '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email&amp;callback={{ .RedirectTo }}',
        CODE_FR, CODE_EN, IGNORE_FR, IGNORE_EN),
    'reset-password.html': page(
        'Réinitialisez votre mot de passe', 'Reset your password',
        'Réinitialiser votre mot de passe', 'Reset your password',
        'Vous avez demandé un nouveau mot de passe pour votre compte Prospectigo. Cliquez sur le bouton ci-dessous pour le choisir.',
        'You asked for a new password for your Prospectigo account. Click the button below to choose it.',
        'Choisir un nouveau mot de passe', 'Choose a new password',
        '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next={{ .SiteURL }}/update-password',
        CODE_FR, CODE_EN,
        IGNORE_FR + ' Votre mot de passe actuel reste valable.', IGNORE_EN + ' Your current password stays valid.'),
    'magic-link.html': page(
        'Votre lien de connexion', 'Your sign-in link',
        'Connexion à Prospectigo', 'Sign in to Prospectigo',
        'Cliquez sur le bouton ci-dessous pour vous connecter. Ce lien ne sert qu’une fois.',
        'Click the button below to sign in. This link can only be used once.',
        'Me connecter', 'Sign in',
        '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=magiclink&amp;callback={{ .RedirectTo }}',
        'Ou saisissez ce code pour vous connecter :', 'Or enter this code to sign in:', IGNORE_FR, IGNORE_EN),
    'change-email-address.html': page(
        'Confirmez votre nouvelle adresse e-mail', 'Confirm your new email address',
        'Changement d’adresse e-mail', 'Email address change',
        'Vous avez demandé à remplacer l’adresse {{ .Email }} par {{ .NewEmail }} sur votre compte Prospectigo. Cliquez sur le bouton ci-dessous pour confirmer ce changement.',
        'You asked to change the email address of your Prospectigo account from {{ .Email }} to {{ .NewEmail }}. Click the button below to confirm the change.',
        'Confirmer la nouvelle adresse', 'Confirm the new address',
        '{{ .ConfirmationURL }}', None, None,
        IGNORE_FR + ' Votre adresse actuelle reste inchangée.', IGNORE_EN + ' Your current address stays unchanged.'),
    # Invitation envoyée par Supabase lui-même (non utilisée par l'application, qui a son propre e-mail
    # d'invitation) : gardée cohérente au cas où.
    'invite-user.html': page(
        'Vous êtes invité(e) sur Prospectigo', 'You are invited to Prospectigo',
        'Vous êtes invité(e) sur Prospectigo', 'You are invited to Prospectigo',
        'Vous avez été invité(e) à créer un compte sur Prospectigo. Cliquez sur le bouton ci-dessous pour accepter l’invitation.',
        'You have been invited to create an account on Prospectigo. Click the button below to accept the invitation.',
        'Accepter l’invitation', 'Accept the invitation',
        '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite&amp;callback={{ .RedirectTo }}',
        None, None, IGNORE_FR, IGNORE_EN),
}

if __name__ == '__main__':
    for name, html in FILES.items():
        (OUT / name).write_text(html)
        print(f'{name} : {len(html)} octets')
