from django import forms
from .models import Listing, Offer


class ListingForm(forms.ModelForm):
    class Meta:
        model = Listing
        fields = [
            "collection_item", "listing_type", "asking_price",
            "quantity_available", "accepts_offers", "description", "trade_wants",
        ]
        widgets = {
            "description": forms.Textarea(attrs={"rows": 3}),
            "trade_wants": forms.Textarea(attrs={"rows": 2,
                                                  "placeholder": "e.g. Looking for Charizard ex, Mox Pearl…"}),
        }

    def __init__(self, user, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Only show items the user owns (not on want list)
        from apps.collection.models import CollectionItem
        self.fields["collection_item"].queryset = (
            CollectionItem.objects
            .filter(user=user, is_hunted=False)
            .select_related("card")
        )
        self.fields["collection_item"].label_from_instance = (
            lambda obj: f"{obj.card.name} [{obj.card.set_name}] — {obj.condition}"
                        f"{' (Foil)' if obj.is_foil else ''} x{obj.quantity}"
        )
        for field in self.fields.values():
            w = field.widget
            if isinstance(w, (forms.TextInput, forms.NumberInput, forms.Select,
                               forms.Textarea)):
                w.attrs["class"] = "form-control form-control-sm bg-dark border-secondary text-light"
            elif isinstance(w, forms.CheckboxInput):
                w.attrs["class"] = "form-check-input"

    def clean(self):
        cd = super().clean()
        ltype = cd.get("listing_type")
        price = cd.get("asking_price")
        if ltype in ("sale", "both") and not price:
            self.add_error("asking_price", "A price is required for sale listings.")
        return cd


class OfferForm(forms.ModelForm):
    class Meta:
        model = Offer
        fields = ["offered_price", "trade_offer_description", "message"]
        widgets = {
            "message":               forms.Textarea(attrs={"rows": 2, "placeholder": "Say something to the seller…"}),
            "trade_offer_description": forms.Textarea(attrs={"rows": 2,
                                                              "placeholder": "Describe cards you're offering in trade…"}),
        }

    def __init__(self, listing=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if listing and listing.listing_type == "trade":
            self.fields["offered_price"].required = False
            self.fields["offered_price"].label = "Cash component ($, optional)"
        for field in self.fields.values():
            w = field.widget
            if isinstance(w, (forms.TextInput, forms.NumberInput, forms.Textarea)):
                w.attrs["class"] = "form-control form-control-sm bg-dark border-secondary text-light"

    def clean(self):
        cd = super().clean()
        if not cd.get("offered_price") and not cd.get("trade_offer_description"):
            raise forms.ValidationError("Provide a cash offer, a trade description, or both.")
        return cd


class CounterOfferForm(forms.Form):
    counter_price   = forms.DecimalField(max_digits=10, decimal_places=2, required=False,
                                          label="Counter price ($)")
    counter_message = forms.CharField(widget=forms.Textarea(attrs={"rows": 2}),
                                       label="Message to buyer")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            w = field.widget
            if isinstance(w, (forms.TextInput, forms.NumberInput, forms.Textarea)):
                w.attrs["class"] = "form-control form-control-sm bg-dark border-secondary text-light"
