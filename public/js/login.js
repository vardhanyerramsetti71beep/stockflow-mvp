SF.initGuestPage(function () {
  SF.onSubmit(document.getElementById('login-form'), async function (values) {
    await SF.api('/auth/login', { method: 'POST', body: values, allow401: true });
    location.href = '/';
  });
});
