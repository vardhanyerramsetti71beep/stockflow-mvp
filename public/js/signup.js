SF.initGuestPage(function () {
  SF.onSubmit(document.getElementById('signup-form'), async function (values) {
    if (values.password !== values.confirmPassword) {
      throw new SF.ApiError(422, { errors: { confirmPassword: 'Passwords do not match.' } });
    }
    const res = await SF.api('/auth/signup', { method: 'POST', body: values });
    SF.flashNext('Welcome to StockFlow, ' + res.organization.name + '!');
    location.href = '/';
  });
});
