/**
 * My Information step: country, source, previous worker, name, address, email, phone.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});
  WDA.fillers = WDA.fillers || {};

  WDA.fillers.myInformation = async (ctx) => {
    const F = WDA.SELECTORS.fields;
    const P = ctx.profile.personal;
    const A = ctx.profile.application;

    // Country first: changing it re-renders the address fields below.
    const country = await ctx.fill('Country', F.country, P.country);
    if (country && country.status === 'filled' && country.reason !== 'already set') await WDA.waitForSettle(500, 3000);

    await ctx.fill('How did you hear about us', F.source, A.howDidYouHear);
    await ctx.fill('Previously worked here', F.previousWorker, A.previouslyWorkedHere);

    await ctx.fill('First name', F.firstName, P.firstName);
    await ctx.fill('Last name', F.lastName, P.lastName);

    if (P.preferredName) {
      const cb = await ctx.fill('Preferred name checkbox', F.preferredNameCheckbox, true);
      if (cb && cb.status === 'filled') await WDA.waitFor(() => WDA.resolve(F.preferredFirstName), { timeout: 3000 });
      await ctx.fill('Preferred name', F.preferredFirstName, P.preferredName);
    }

    await ctx.fill('Address line 1', F.address1, P.address1);
    await ctx.fill('Address line 2', F.address2, P.address2);
    await ctx.fill('City', F.city, P.city);
    await ctx.fill('State / Province', F.state, P.state);
    await ctx.fill('Postal code', F.postalCode, P.postalCode);

    await ctx.fill('Email', F.email, P.email);
    await ctx.fill('Phone device type', F.phoneDeviceType, P.phoneDeviceType);
    const code = [P.phoneCountry, P.phoneCode].filter(Boolean).join('|');
    await ctx.fill('Country phone code', F.phoneCode, code);
    await ctx.fill('Phone number', F.phoneNumber, P.phoneNumber);
    await ctx.fill('Phone extension', F.phoneExtension, P.phoneExtension);

    // Some tenants ask for LinkedIn here
    await ctx.fill('LinkedIn', F.linkedin, ctx.profile.links.linkedin);
  };
})();
