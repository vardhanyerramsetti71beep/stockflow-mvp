SF.initPage(async function () {
  const form = document.getElementById('settings-form');
  const data = await SF.api('/settings');
  form.elements.defaultLowStockThreshold.value = data.defaultLowStockThreshold;

  SF.onSubmit(form, async function (values) {
    const res = await SF.api('/settings', { method: 'PUT', body: values });
    form.elements.defaultLowStockThreshold.value = res.defaultLowStockThreshold;
    SF.toast('Settings saved.');
  });
});
