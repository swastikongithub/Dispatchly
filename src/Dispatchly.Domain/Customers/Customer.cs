namespace Dispatchly.Domain.Customers;

public sealed class Customer
{
    private readonly List<SavedAddress> _savedAddresses = [];

    public Customer(string name, string phone, IEnumerable<SavedAddress> savedAddresses)
    {
        Name = name;
        Phone = phone;
        _savedAddresses.AddRange(savedAddresses.Select(a => new SavedAddress
        {
            Label = a.Label,
            Address = a.Address,
            Area = a.Area,
            Lat = a.Lat,
            Lng = a.Lng,
        }));
    }

    private Customer()
    {
    }

    public int Id { get; private set; }
    public string Name { get; private set; } = "";
    public string Phone { get; private set; } = "";
    public IReadOnlyList<SavedAddress> SavedAddresses => _savedAddresses;
}

public sealed class SavedAddress
{
    /// <summary>e.g. "Home", shown on the drop pin.</summary>
    public required string Label { get; init; }

    public required string Address { get; init; }
    public required string Area { get; init; }
    public required double Lat { get; init; }
    public required double Lng { get; init; }
}
