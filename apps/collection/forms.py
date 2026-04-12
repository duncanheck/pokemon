from django import forms
from .models import CollectionItem


class AddToCollectionForm(forms.Form):
    """Used on both search results page and card detail page."""
    card_tcg_id    = forms.CharField(widget=forms.HiddenInput)
    condition      = forms.ChoiceField(choices=CollectionItem.CONDITION_CHOICES, initial="NM")
    quantity       = forms.IntegerField(min_value=1, max_value=9999, initial=1)
    is_foil        = forms.BooleanField(required=False)
    is_hunted      = forms.BooleanField(required=False, label="Add to Want List instead")
    purchase_price = forms.DecimalField(max_digits=10, decimal_places=2, required=False,
                                        label="Purchase price (optional)")
    purchase_date  = forms.DateField(required=False, widget=forms.DateInput(attrs={"type": "date"}))
    notes          = forms.CharField(required=False, widget=forms.Textarea(attrs={"rows": 2}))

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            widget = field.widget
            if isinstance(widget, (forms.TextInput, forms.NumberInput, forms.Select,
                                   forms.DateInput, forms.Textarea)):
                existing = widget.attrs.get("class", "")
                widget.attrs["class"] = (existing + " form-control form-control-sm").strip()
            if isinstance(widget, forms.CheckboxInput):
                widget.attrs["class"] = "form-check-input"


class EditCollectionItemForm(forms.ModelForm):
    class Meta:
        model = CollectionItem
        fields = ["condition", "quantity", "is_foil", "purchase_price",
                  "purchase_date", "is_hunted", "for_sale", "notes",
                  "alert_surge_pct", "alert_drop_pct"]
        widgets = {
            "purchase_date":    forms.DateInput(attrs={"type": "date"}),
            "notes":            forms.Textarea(attrs={"rows": 2}),
            "alert_surge_pct":  forms.NumberInput(attrs={"placeholder": "15"}),
            "alert_drop_pct":   forms.NumberInput(attrs={"placeholder": "15"}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name, field in self.fields.items():
            widget = field.widget
            if isinstance(widget, (forms.TextInput, forms.NumberInput, forms.Select,
                                   forms.DateInput, forms.Textarea)):
                widget.attrs["class"] = "form-control form-control-sm"
            elif isinstance(widget, forms.CheckboxInput):
                widget.attrs["class"] = "form-check-input"
