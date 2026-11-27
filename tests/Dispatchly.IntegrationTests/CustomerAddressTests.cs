using System.Net;
using Dispatchly.Application;
using Dispatchly.Domain.Customers;
using Dispatchly.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace Dispatchly.IntegrationTests;

/// <summary>GET /customer/addresses: where the order page centres the map and drops the pin.</summary>
public sealed class CustomerAddressTests(PostgisServer postgis)
{
    private const string Url = "/api/v1/customer/addresses";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_demo_customer_gets_their_home_address()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);
        var id = await app.DemoCustomerIdAsync();

        var addresses = await app.Customer(id).GetJsonAsync<List<CustomerAddress>>(Url);

        var home = Assert.Single(addresses);
        Assert.Equal("Home", home.Label);
        Assert.Equal("B-14, Lajpat Nagar II", home.Address);
        Assert.Equal("Lajpat Nagar II", home.Area);
        var saved = await app.QueryAsync(db => db.Customers.Where(c => c.Id == id).Select(c => c.SavedAddresses).SingleAsync(Ct));
        Assert.Equal(saved[0].Lat, home.Location.Lat);
        Assert.Equal(saved[0].Lng, home.Location.Lng);
    }

    [Fact]
    public async Task Addresses_come_in_the_order_they_were_saved()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var customer = new Customer("Kabir Rao", "+91 00000 02002",
        [
            new SavedAddress { Label = "Home", Address = "C-9, Nizamuddin East", Area = "Nizamuddin East", Lat = 28.5893, Lng = 77.2510 },
            new SavedAddress { Label = "Work", Address = "F-41, Inner Circle", Area = "Connaught Place", Lat = 28.6328, Lng = 77.2197 },
        ]);
        await app.ExecuteAsync(db =>
        {
            db.Add(customer);
            return db.SaveChangesAsync(Ct);
        });

        var addresses = await app.Customer(customer.Id).GetJsonAsync<List<CustomerAddress>>(Url);

        Assert.Equal(
            [
                new CustomerAddress("Home", "C-9, Nizamuddin East", "Nizamuddin East", new Position(28.5893, 77.2510)),
                new CustomerAddress("Work", "F-41, Inner Circle", "Connaught Place", new Position(28.6328, 77.2197)),
            ],
            addresses);
    }

    [Fact]
    public async Task A_customer_who_no_longer_exists_is_not_found()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);

        var response = await app.Customer(customerId: 999_999).GetAsync(Url, Ct);

        await response.AssertProblemAsync(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Only_a_signed_in_customer_can_read_addresses()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);

        Assert.Equal(HttpStatusCode.Unauthorized, (await app.Client().GetAsync(Url, Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await app.Dispatcher().GetAsync(Url, Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await app.Rider(await app.DemoRiderIdAsync()).GetAsync(Url, Ct)).StatusCode);
    }
}
