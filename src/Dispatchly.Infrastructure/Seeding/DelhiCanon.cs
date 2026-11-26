using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Restaurants;

namespace Dispatchly.Infrastructure.Seeding;

/// <summary>
/// The sample data canon (PLAN.md §12): real central Delhi areas, invented restaurants, the named
/// riders from the designs. Coordinates are approximate area centres.
/// </summary>
internal static class DelhiCanon
{
    public static readonly IReadOnlyDictionary<string, GeoPoint> Areas = new Dictionary<string, GeoPoint>
    {
        ["Connaught Place"] = new(28.6315, 77.2167),
        ["Paharganj"] = new(28.6418, 77.2131),
        ["Karol Bagh"] = new(28.6519, 77.1909),
        ["Daryaganj"] = new(28.6449, 77.2405),
        ["Chanakyapuri"] = new(28.5974, 77.1866),
        ["India Gate"] = new(28.6129, 77.2295),
        ["Lodhi Colony"] = new(28.5850, 77.2190),
        ["Lajpat Nagar II"] = new(28.5672, 77.2372),
        ["Hauz Khas"] = new(28.5494, 77.2001),
        ["Green Park"] = new(28.5590, 77.2066),
        ["Gole Market"] = new(28.6331, 77.2042),
        ["Nizamuddin East"] = new(28.5900, 77.2510),
        ["Laxmi Nagar"] = new(28.6304, 77.2773),
        ["Khan Market"] = new(28.6003, 77.2270),
        ["Sundar Nagar"] = new(28.6032, 77.2423),
        ["ITO"] = new(28.6286, 77.2410),
    };

    public sealed record RestaurantSeed(string Name, string Area, string Address, int PrepMinutes, MenuItem[] Menu);

    private static MenuItem Item(string name, int rupees) => new()
    {
        Id = string.Join('-', name.ToLowerInvariant().Split([' ', '&', '.', ','], StringSplitOptions.RemoveEmptyEntries)),
        Name = name,
        PricePaise = rupees * 100,
    };

    /// <summary>The seven restaurants named in the canon, with the menus the designs show.</summary>
    public static readonly RestaurantSeed[] Named =
    [
        new("Saffron & Smoke", "Khan Market", "Shop 21, Middle Lane, Khan Market", 12,
            [Item("Smoked butter chicken", 460), Item("Dal makhani", 180), Item("Garlic naan", 60), Item("Jeera rice", 90)]),
        new("Momo Lab", "Hauz Khas", "14 Hauz Khas Village", 10,
            [Item("Steamed chicken momos", 180), Item("Tandoori paneer momos", 220), Item("Thukpa", 240)]),
        new("Kulfi & Co.", "Connaught Place", "N-12, Outer Circle, Connaught Place", 6,
            [Item("Malai kulfi", 90), Item("Pista kulfi", 110), Item("Rabri falooda", 160)]),
        new("Lahori Gate Kitchen", "Daryaganj", "4/18 Netaji Subhash Marg, Daryaganj", 15,
            [Item("Mutton nihari", 420), Item("Chicken korma", 340), Item("Khamiri roti", 40)]),
        new("Second Pour Café", "Paharganj", "Shop 7, Main Bazar, Paharganj", 8,
            [Item("Cold brew", 220), Item("Almond croissant", 180), Item("Flat white", 190), Item("Avocado toast", 280)]),
        new("Tiffin Theory", "Sundar Nagar", "Shop 9, Sundar Nagar Market", 12,
            [Item("Mini thali", 260), Item("Rajma chawal", 190), Item("Chole kulche", 170)]),
        new("Masala Mill", "Lodhi Colony", "Meherchand Market, Lodhi Colony", 10,
            [Item("Masala dosa", 160), Item("Idli sambar", 120), Item("Filter coffee", 70)]),
    ];

    private static readonly MenuItem[][] Menus =
    [
        [Item("Paneer tikka", 280), Item("Butter naan", 60), Item("Dal tadka", 190)],
        [Item("Chicken biryani", 320), Item("Veg biryani", 240), Item("Raita", 60)],
        [Item("Chicken kathi roll", 170), Item("Paneer kathi roll", 150), Item("Masala fries", 110)],
        [Item("Aloo tikki chaat", 120), Item("Papdi chaat", 110), Item("Lassi", 90)],
        [Item("Hakka noodles", 210), Item("Chilli paneer", 240), Item("Spring rolls", 160)],
        [Item("Chole bhature", 180), Item("Amritsari kulcha", 200), Item("Sweet lassi", 90)],
        [Item("Gulab jamun", 80), Item("Rasmalai", 120), Item("Jalebi with rabri", 140)],
        [Item("Cappuccino", 180), Item("Banana bread", 160), Item("Cold coffee", 190)],
    ];

    private static readonly (string Name, string Area, string Street)[] Invented =
    [
        ("Ember & Tawa", "Connaught Place", "F-41, Inner Circle"),
        ("Little Lassi", "Connaught Place", "Block B, Middle Circle"),
        ("Rasoi Row", "Paharganj", "Chuna Mandi"),
        ("Bun Maska Bar", "Paharganj", "Arakashan Road"),
        ("Pind Plate", "Karol Bagh", "Ajmal Khan Road"),
        ("Gully Grill", "Karol Bagh", "Pusa Road"),
        ("Dal & Dough", "Karol Bagh", "Bank Street"),
        ("Kathi Lane", "Daryaganj", "Ansari Road"),
        ("Old Lamp Biryani", "Daryaganj", "Delhi Gate"),
        ("Embassy Greens", "Chanakyapuri", "Malcha Marg Market"),
        ("Diplomat's Dosa", "Chanakyapuri", "Satya Marg"),
        ("Rajpath Rolls", "India Gate", "Pandara Road Market"),
        ("Pandara Pantry", "India Gate", "Pandara Road"),
        ("Courtyard Chai", "Lodhi Colony", "Khanna Market"),
        ("Mithai Mill", "Lodhi Colony", "Lodhi Road"),
        ("Central Tandoor", "Lajpat Nagar II", "Central Market"),
        ("Ring Road Rasoi", "Lajpat Nagar II", "Double Storey"),
        ("Noodle Nagar", "Lajpat Nagar II", "Amar Colony"),
        ("Deer Park Deli", "Hauz Khas", "Hauz Khas Village"),
        ("Lakeside Kulcha", "Hauz Khas", "Aurobindo Marg"),
        ("Green Park Grub", "Green Park", "Main Market"),
        ("Aurobindo Eats", "Green Park", "Aurobindo Place"),
        ("Gole Market Gully", "Gole Market", "Bhai Vir Singh Marg"),
        ("Copper Kadhai", "Gole Market", "Baird Lane"),
        ("Dargah Lane Kitchen", "Nizamuddin East", "Mathura Road"),
        ("Basti Biryani", "Nizamuddin East", "Lodhi Road"),
        ("Metro Momos", "Laxmi Nagar", "Vikas Marg"),
        ("Yamuna Bites", "Laxmi Nagar", "Shakarpur"),
        ("Middle Lane Bakehouse", "Khan Market", "Middle Lane"),
        ("Sundar Sweets & Snacks", "Sundar Nagar", "Sundar Nagar Market"),
        ("Pragati Paratha", "ITO", "Vikas Marg"),
        ("Zafar Marg Thali", "ITO", "Bahadur Shah Zafar Marg"),
        ("Bazaar Bowl", "Paharganj", "Main Bazar"),
    ];

    public static IEnumerable<RestaurantSeed> InventedRestaurants(Random random) =>
        Invented.Select((r, i) => new RestaurantSeed(
            r.Name,
            r.Area,
            $"{random.Next(1, 90)}, {r.Street}, {r.Area}",
            random.Next(8, 21),
            Menus[i % Menus.Length]));

    /// <summary>The riders named in the designs, in the canon's order.</summary>
    public static readonly (string Name, string Vehicle, string Plate)[] NamedRiders =
    [
        ("Aman Verma", "Honda Activa", "DL 3S CK 2041"),
        ("Ritika Sharma", "TVS Jupiter", "DL 8S BX 7712"),
        ("Imran Ali", "Bajaj Pulsar", "DL 5S AQ 3390"),
        ("Neha Gupta", "Suzuki Access", "DL 1S DF 5524"),
        ("Karan Mehta", "Ather 450X", "DL 9S CM 1187"),
    ];

    public static readonly string[] FirstNames =
    [
        "Aarav", "Vihaan", "Arjun", "Rohan", "Kabir", "Ishaan", "Aditya", "Rahul", "Sameer", "Vikram",
        "Deepak", "Manish", "Sunil", "Ravi", "Pankaj", "Nikhil", "Saurabh", "Ankit", "Gaurav", "Harsh",
        "Faizan", "Salman", "Arif", "Zubair", "Gurpreet", "Harjit", "Jaspreet", "Amit", "Varun", "Yash",
        "Priya", "Anjali", "Pooja", "Sneha", "Kavya", "Meera", "Sana", "Ayesha", "Simran", "Divya",
    ];

    public static readonly string[] LastNames =
    [
        "Sharma", "Verma", "Gupta", "Singh", "Kumar", "Yadav", "Chauhan", "Malhotra", "Kapoor", "Bansal",
        "Agarwal", "Joshi", "Mishra", "Pandey", "Khan", "Qureshi", "Ansari", "Gill", "Sandhu", "Rawat",
        "Negi", "Bisht", "Saxena", "Arora", "Bhatia", "Sethi", "Tiwari", "Dubey", "Rana", "Thakur",
    ];

    public static readonly string[] Vehicles =
    [
        "Honda Activa", "TVS Jupiter", "Suzuki Access", "Hero Splendor", "Bajaj Pulsar", "Ather 450X", "TVS iQube", "Honda Shine",
    ];

    public static readonly string[] Customers =
    [
        "Priya Nair", "Rahul Khanna", "Ananya Iyer", "Siddharth Bose", "Meher Kaur", "Arjun Pillai", "Tanvi Desai",
        "Kunal Ahuja", "Ishita Menon", "Farhan Siddiqui", "Riya Chopra", "Dev Malhotra", "Nandini Rao", "Aditya Sood",
        "Zoya Mirza", "Vivek Anand", "Sara Thomas", "Mohit Jain", "Kriti Bhalla", "Aryan Sehgal",
    ];
}
